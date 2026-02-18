import { useState, useEffect, useRef } from 'react';
import API_BASE from '../config';

export default function Dashboard() {
    // ─── Generate Leads (Quick) ─────────────────────────────────
    const [campaignName, setCampaignName] = useState('');
    const [gender, setGender] = useState('All');
    const [limit, setLimit] = useState(100);
    const [stopOnLimitReached, setStopOnLimitReached] = useState(true);
    const [campaignSource, setCampaignSource] = useState('All');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    // ─── Lead Browser ─────────────────────────────────────────────
    const [leads, setLeads] = useState([]);
    const [leadsTotal, setLeadsTotal] = useState(0);
    const [leadsPage, setLeadsPage] = useState(1);
    const [browseTag, setBrowseTag] = useState('');
    const [browseSource, setBrowseSource] = useState('');
    const [browseIndustry, setBrowseIndustry] = useState('');
    const [browseJobTitle, setBrowseJobTitle] = useState('');
    const [loadingLeads, setLoadingLeads] = useState(false);
    const [filterOptions, setFilterOptions] = useState({ sources: [], industries: [], jobTitles: [] });

    // ─── List Generator (CSV-only) ─────────────────────────────
    const [listName, setListName] = useState('');
    const [listGender, setListGender] = useState('All');
    const [listTarget, setListTarget] = useState(1000);
    const [listIndustry, setListIndustry] = useState('');
    const [listLoading, setListLoading] = useState(false);
    const [listResult, setListResult] = useState(null);
    const [listError, setListError] = useState('');
    const [listProgress, setListProgress] = useState(null);
    const eventSourceRef = useRef(null);

    // ─── Top Industries Modal ─────────────────────────────────
    const [showIndustryModal, setShowIndustryModal] = useState(false);
    const [topIndustries, setTopIndustries] = useState([]);
    const [industriesLoading, setIndustriesLoading] = useState(false);
    const [industrySearch, setIndustrySearch] = useState('');

    // ─── Suppression List ──────────────────────────────────
    const [suppressionStats, setSuppressionStats] = useState(null);
    const [suppressionLoading, setSuppressionLoading] = useState(false);
    const [suppressionMsg, setSuppressionMsg] = useState('');

    // ─── Lead Stats panel ──────────────────────────────────
    const [stats, setStats] = useState([]);
    const [statsExpanded, setStatsExpanded] = useState(false);
    const [statsPage, setStatsPage] = useState(1);
    const STATS_PER_PAGE = 15;
    const [availableSources, setAvailableSources] = useState([]);

    // Load stats on mount
    useEffect(() => {
        fetchStats();
        fetchSuppressionStats();
        fetchFilterOptions();
        // Load available sources from settings
        fetch(`${API_BASE}/api/settings`)
            .then(res => res.json())
            .then(data => {
                try {
                    const sources = JSON.parse(data.enabled_sources || '[]');
                    setAvailableSources(sources);
                } catch (e) { setAvailableSources([]); }
            })
            .catch(() => { });
    }, []);

    // ─── Keep-Alive Ping ─────────────────────────────────────────
    // Pings /api/health every 3 minutes while this tab is open,
    // preventing Render free tier from sleeping the server.
    useEffect(() => {
        const PING_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
        const interval = setInterval(() => {
            fetch(`${API_BASE}/api/health`).catch(() => { });
        }, PING_INTERVAL_MS);
        // Also ping immediately on mount so we wake Render right away
        fetch(`${API_BASE}/api/health`).catch(() => { });
        return () => clearInterval(interval);
    }, []);

    async function fetchStats() {
        try {
            const res = await fetch(`${API_BASE}/api/leads/stats`);
            const data = await res.json();
            setStats(data);
        } catch (err) {
            console.error('Failed to load stats:', err);
        }
    }

    async function fetchFilterOptions() {
        try {
            const res = await fetch(`${API_BASE}/api/leads/filters`);
            const data = await res.json();
            setFilterOptions(data);
        } catch (err) {
            console.error('Failed to load filter options:', err);
        }
    }

    // ─── Generate Leads (Quick) Handler ───────────────────────────
    const handleCreate = async (e) => {
        e.preventDefault();
        if (!campaignName) return;

        setLoading(true);
        setError('');
        setResult(null);

        try {
            const res = await fetch(`${API_BASE}/api/campaigns/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaignName,
                    gender,
                    limit,
                    stopOnLimitReached,
                    source: campaignSource
                })
            });
            const data = await res.json();

            if (res.ok) {
                setResult(data);
                fetchStats();
            } else {
                const errorMsg = data.message || data.error || 'Failed to generate leads';
                const tip = data.details?.tip ? ` Tip: ${data.details.tip}` : '';
                setError(errorMsg + tip);
            }
        } catch (err) {
            setError(err.message || 'Network error occurred');
        } finally {
            setLoading(false);
        }
    };

    // ─── Load Leads ──────────────────────────────────────────────
    const fetchLeads = async () => {
        setLoadingLeads(true);
        try {
            const params = new URLSearchParams();
            if (browseTag) params.set('sourceCampaignTag', browseTag);
            if (browseSource) params.set('source', browseSource);
            if (browseIndustry) params.set('industry', browseIndustry);
            if (browseJobTitle) params.set('jobTitle', browseJobTitle);
            params.set('page', leadsPage);
            params.set('limit', 50);

            const res = await fetch(`${API_BASE}/api/leads?${params.toString()}`);
            const data = await res.json();
            setLeads(data.leads || []);
            setLeadsTotal(data.total || 0);
        } catch (err) {
            console.error('Failed to load leads:', err);
        } finally {
            setLoadingLeads(false);
        }
    };

    const handleExport = (tag) => {
        const params = new URLSearchParams();
        if (tag) {
            params.set('sourceCampaignTag', tag);
        } else {
            if (browseTag) params.set('sourceCampaignTag', browseTag);
        }
        // Use a one-time programmatic <a> click to guarantee exactly one download
        const url = `${API_BASE}/api/leads/export?${params.toString()}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // ─── List Generator Handler (SSE for live progress) ─────────
    const handleGenerateList = async (e) => {
        e.preventDefault();
        if (!listName) return;

        setListLoading(true);
        setListError('');
        setListResult(null);
        setListProgress(null);

        const params = new URLSearchParams({
            listName,
            gender: listGender,
            target: listTarget
        });
        if (listIndustry.trim()) {
            params.set('industryFilter', listIndustry.trim());
        }

        const eventSource = new EventSource(`${API_BASE}/api/lists/generate?${params.toString()}`);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'progress' || data.type === 'status') {
                    setListProgress(data);
                } else if (data.type === 'done') {
                    setListResult(data);
                    setListProgress(null);
                    setListLoading(false);
                    fetchStats();
                    eventSource.close();
                    eventSourceRef.current = null;
                } else if (data.type === 'error') {
                    setListError(data.message);
                    setListProgress(null);
                    setListLoading(false);
                    eventSource.close();
                    eventSourceRef.current = null;
                }
            } catch (err) {
                console.error('SSE parse error:', err);
            }
        };

        eventSource.onerror = () => {
            if (eventSource.readyState === EventSource.CLOSED) return;
            setListError('Connection lost to server');
            setListProgress(null);
            setListLoading(false);
            eventSource.close();
            eventSourceRef.current = null;
        };
    };

    const handleStopGeneration = () => {
        const stoppedProgress = listProgress;
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        setListProgress(null);
        setListLoading(false);
        if (stoppedProgress && stoppedProgress.clean > 0) {
            setListResult({
                listName: listName,
                requested: listTarget,
                cleanLeads: stoppedProgress.clean || 0,
                stats: {
                    totalFetched: stoppedProgress.fetched || 0,
                    totalSentToReoon: stoppedProgress.sent_to_reoon || 0,
                    statusBreakdown: stoppedProgress.breakdown || {}
                },
                stopped: true
            });
        } else {
            setListError('🛑 Generation stopped. No clean leads were found before stopping.');
        }
        fetchStats();
    };

    // ─── Suppression List Handlers ──────────────────────────────
    async function fetchSuppressionStats() {
        try {
            const res = await fetch(`${API_BASE}/api/suppression/stats`);
            const data = await res.json();
            setSuppressionStats(data);
        } catch (err) {
            console.error('Failed to load suppression stats:', err);
        }
    }

    const handleSyncFromLeads = async () => {
        setSuppressionLoading(true);
        setSuppressionMsg('');
        try {
            const res = await fetch(`${API_BASE}/api/suppression/sync-from-leads`, { method: 'POST' });
            const data = await res.json();
            setSuppressionMsg(`✅ Synced ${data.newEmailsAdded} new emails from ${data.existingLeads} leads. Total suppressed: ${data.totalSuppressed}`);
            fetchSuppressionStats();
        } catch (err) {
            setSuppressionMsg('❌ ' + err.message);
        } finally {
            setSuppressionLoading(false);
        }
    };

    const handleUploadSuppression = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setSuppressionLoading(true);
        setSuppressionMsg('');
        try {
            const text = await file.text();
            const res = await fetch(`${API_BASE}/api/suppression/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: text
            });
            const data = await res.json();
            if (res.ok) {
                setSuppressionMsg(`✅ Uploaded ${data.newEmailsAdded} new emails from ${data.emailsInFile} in file. Total suppressed: ${data.totalSuppressed}`);
            } else {
                setSuppressionMsg('❌ ' + data.error);
            }
            fetchSuppressionStats();
        } catch (err) {
            setSuppressionMsg('❌ ' + err.message);
        } finally {
            setSuppressionLoading(false);
            e.target.value = '';
        }
    };

    const handleClearSuppression = async () => {
        if (!window.confirm('Clear ALL suppression emails? This cannot be undone.')) return;
        setSuppressionLoading(true);
        try {
            await fetch(`${API_BASE}/api/suppression/clear`, { method: 'DELETE' });
            setSuppressionMsg('✅ Suppression list cleared.');
            fetchSuppressionStats();
        } catch (err) {
            setSuppressionMsg('❌ ' + err.message);
        } finally {
            setSuppressionLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* ── Suppression List ───────────────────────── */}
            <div className="bg-white shadow rounded-lg p-6 border-l-4 border-red-400">
                <h2 className="text-xl font-semibold mb-2 text-gray-800">
                    🚫 Suppression List (Dedup Before Reoon)
                </h2>
                <p className="text-sm text-gray-500 mb-3">
                    Emails in this list will be skipped BEFORE Reoon verification — saving API credits.
                    Upload your export, or sync from existing leads.
                </p>

                <div className="flex flex-wrap items-center gap-3 mb-3">
                    <span className="text-sm font-medium text-gray-700">
                        📊 Suppressed emails: <strong className="text-red-600">{suppressionStats?.total ?? '...'}</strong>
                    </span>

                    <button
                        onClick={handleSyncFromLeads}
                        disabled={suppressionLoading}
                        className="text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-200 disabled:bg-gray-200"
                    >
                        🔄 Sync from Existing Leads
                    </button>

                    <label className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded hover:bg-orange-200 cursor-pointer">
                        📤 Upload CSV / Email List
                        <input type="file" accept=".csv,.txt" className="hidden" onChange={handleUploadSuppression} />
                    </label>

                    <button
                        onClick={handleClearSuppression}
                        disabled={suppressionLoading}
                        className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded hover:bg-red-200 disabled:bg-gray-200"
                    >
                        🗑️ Clear All
                    </button>
                </div>

                {suppressionMsg && (
                    <p className={`text-sm ${suppressionMsg.startsWith('✅') ? 'text-green-700' : 'text-red-700'}`}>
                        {suppressionMsg}
                    </p>
                )}
            </div>

            {/* ── Generate Lead List (CSV Export) ────────────────── */}
            <div className="bg-white shadow rounded-lg p-6 border-l-4 border-indigo-500">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">
                    📋 Generate Lead List
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                    Build large, clean email lists by gender and source. Verified with Reoon, then export as CSV.
                </p>
                <form onSubmit={handleGenerateList} className="space-y-4 max-w-lg">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">List Name</label>
                        <input
                            type="text"
                            className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                            placeholder="e.g. MEN_40k_Feb or WomenCoaches_10k"
                            value={listName}
                            onChange={(e) => setListName(e.target.value)}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gender Filter</label>
                        <select
                            className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                            value={listGender}
                            onChange={(e) => setListGender(e.target.value)}
                        >
                            <option value="All">All (No Filter)</option>
                            <option value="male">Men</option>
                            <option value="female">Women</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Industry Contains <span className="text-gray-400 font-normal">(optional)</span>
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                className="flex-1 border border-gray-300 rounded-md shadow-sm p-2"
                                placeholder="e.g. Dentist, Real Estate, Coach"
                                value={listIndustry}
                                onChange={(e) => setListIndustry(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={async () => {
                                    setShowIndustryModal(true);
                                    setIndustriesLoading(true);
                                    setIndustrySearch('');
                                    try {
                                        const res = await fetch(`${API_BASE}/api/industries/top`);
                                        const data = await res.json();
                                        setTopIndustries(data.industries || []);
                                    } catch (err) {
                                        console.error('Failed to load industries:', err);
                                        setTopIndustries([]);
                                    }
                                    setIndustriesLoading(false);
                                }}
                                className="bg-indigo-50 text-indigo-700 px-3 py-2 rounded-md border border-indigo-200 hover:bg-indigo-100 text-sm whitespace-nowrap transition-colors"
                            >
                                📊 Browse
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Leave blank for all industries. Partial match — "Real" will match "Real Estate".</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Lead Target</label>
                        <input
                            type="number"
                            min="1"
                            className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                            placeholder="e.g. 40000"
                            value={listTarget}
                            onChange={(e) => setListTarget(parseInt(e.target.value) || 1000)}
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            No hard cap. Will keep fetching until target is met or BigQuery source is exhausted.
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={listLoading}
                        className="bg-indigo-600 text-white px-6 py-2 rounded-md hover:bg-indigo-700 disabled:bg-gray-400 transition-colors"
                    >
                        {listLoading ? '⏳ Generating... (this may take a while for large lists)' : '📋 Generate Lead List'}
                    </button>
                </form>

                {listProgress && (
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                                <p className="text-blue-800 font-medium text-sm">{listProgress.message}</p>
                            </div>
                            <button
                                onClick={handleStopGeneration}
                                className="bg-red-600 text-white px-4 py-1.5 rounded-md hover:bg-red-700 text-sm font-bold transition-colors shadow-sm"
                            >
                                🛑 STOP — Save & Abort
                            </button>
                        </div>

                        {listProgress.target && (
                            <>
                                {/* Progress bar */}
                                <div className="w-full bg-blue-200 rounded-full h-4 mb-2 overflow-hidden">
                                    <div
                                        className="bg-blue-600 h-4 rounded-full transition-all duration-300 flex items-center justify-center"
                                        style={{ width: `${Math.min(100, ((listProgress.clean || 0) / listProgress.target) * 100)}%` }}
                                    >
                                        {listProgress.clean > 0 && (
                                            <span className="text-white text-xs font-bold">
                                                {Math.round(((listProgress.clean || 0) / listProgress.target) * 100)}%
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Stats line */}
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                                    <span>✅ Clean: <strong className="text-green-700">{listProgress.clean || 0}</strong> / {listProgress.target}</span>
                                    <span>📦 Fetched: <strong>{listProgress.fetched || 0}</strong></span>
                                    <span>🔍 Reoon calls: <strong>{listProgress.sent_to_reoon || 0}</strong></span>
                                    {(listProgress.breakdown?.cached || 0) > 0 && (
                                        <span>💾 Cached (free): <strong className="text-blue-700">{listProgress.breakdown.cached}</strong></span>
                                    )}
                                    <span>🚫 Dupes/Suppressed: <strong>{(listProgress.duplicates || 0) + (listProgress.suppressed || 0)}</strong></span>
                                    {(listProgress.breakdown?.pre_filtered || 0) > 0 && (
                                        <span>🗑️ Pre-filtered junk: <strong className="text-purple-700">{listProgress.breakdown.pre_filtered}</strong></span>
                                    )}
                                </div>

                                {/* Breakdown */}
                                {listProgress.breakdown && Object.keys(listProgress.breakdown).length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                        {Object.entries(listProgress.breakdown).map(([status, count]) => (
                                            <span key={status} className={`px-2 py-0.5 rounded-full font-medium ${status === 'safe' ? 'bg-green-100 text-green-800'
                                                : status === 'invalid' ? 'bg-red-100 text-red-800'
                                                    : status === 'catch_all' ? 'bg-yellow-100 text-yellow-800'
                                                        : status === 'pre_filtered' ? 'bg-purple-100 text-purple-800'
                                                            : status === 'cached' ? 'bg-blue-100 text-blue-800'
                                                                : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                {status === 'pre_filtered' ? '🗑️ pre_filtered' : status === 'cached' ? '💾 cached' : status}: {count}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {listResult && (
                    <div className={`mt-4 p-4 rounded-md ${listResult.stopped ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200'}`}>
                        <p className={`${listResult.stopped ? 'text-orange-800' : 'text-green-800'} font-medium`}>
                            {listResult.stopped ? `🛑 Stopped — "${listResult.listName}" (${listResult.cleanLeads} leads saved)` : `✅ List "${listResult.listName}" generated!`}
                        </p>
                        <ul className="mt-2 text-sm text-gray-700 space-y-1">
                            <li>🔹 Requested: <strong>{listResult.requested}</strong></li>
                            <li>🔸 BigQuery Fetched: <strong>{listResult.stats?.totalFetched}</strong></li>
                            <li>🔸 After Local Filters: <strong>{listResult.stats?.totalCandidatesAfterLocalFilter}</strong></li>
                            <li>🔸 Sent to Reoon: <strong>{listResult.stats?.totalSentToReoon}</strong></li>
                            {(listResult.stats?.statusBreakdown?.cached || 0) > 0 && (
                                <li>💾 Cached (free - 0 credits): <strong className="text-blue-700">{listResult.stats.statusBreakdown.cached}</strong></li>
                            )}
                            <li>✅ Verified & Stored: <strong className="text-green-700">{listResult.cleanLeads}</strong></li>
                            {listResult.stats?.statusBreakdown && (
                                <>
                                    <li className="pt-2 font-semibold text-gray-800">Reoon Breakdown:</li>
                                    {Object.entries(listResult.stats.statusBreakdown).map(([status, count]) => (
                                        <li key={status}>
                                            {status === 'safe' ? '✅' : status === 'invalid' ? '❌' : status === 'catch_all' ? '📨' : status === 'unknown' ? '❓' : status === 'cached' ? '💾' : status === 'pre_filtered' ? '🗑️' : '⚠️'}
                                            {' '}{status}: <strong>{count}</strong>
                                            {status === 'safe' && listResult.stats.totalSentToReoon > 0 && (
                                                <span className="text-gray-400 ml-1">({Math.round(count / listResult.stats.totalSentToReoon * 100)}% of Reoon calls)</span>
                                            )}
                                        </li>
                                    ))}
                                </>
                            )}
                            {/* Per-source stats */}
                            {listResult.stats?.sourceStats && Object.keys(listResult.stats.sourceStats).length > 0 && (
                                <>
                                    <li className="pt-2 font-semibold text-gray-800">📊 Per-Source Performance:</li>
                                    {Object.entries(listResult.stats.sourceStats).map(([src, stats]) => (
                                        <li key={src} className="ml-4">
                                            <strong>{src}</strong>: {stats.total} checked —
                                            <span className="text-green-700">{stats.safe} safe ({stats.total > 0 ? Math.round(stats.safe / stats.total * 100) : 0}%)</span>,{' '}
                                            <span className="text-red-600">{stats.invalid} invalid</span>,{' '}
                                            <span className="text-yellow-600">{stats.catch_all} catch_all</span>,{' '}
                                            <span className="text-gray-500">{stats.unknown} unknown</span>
                                        </li>
                                    ))}
                                </>
                            )}
                            {/* Audit CSV link removed — not needed for this workflow */}
                            {listResult.exhausted && <li className="text-orange-600 font-bold italic">⚠️ Source Exhausted — could not reach target</li>}
                        </ul>
                        <button
                            onClick={() => handleExport(listResult.listName)}
                            className="mt-3 bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition-colors"
                        >
                            📥 Export CSV for "{listResult.listName}"
                        </button>
                    </div>
                )}

                {listError && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-red-800">❌ {listError}</p>
                    </div>
                )}
            </div>


            {/* ── Quick Generate (smaller batches, no streaming) ────── */}
            <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">
                    ⚡ Quick Generate
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                    Generate a smaller batch of verified leads quickly. For large lists, use Generate Lead List above.
                </p>
                <form onSubmit={handleCreate} className="space-y-4 max-w-lg">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">List Name</label>
                        <input
                            type="text"
                            className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                            placeholder="e.g. Quick_Test_50"
                            value={campaignName}
                            onChange={(e) => setCampaignName(e.target.value)}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gender Filter</label>
                        <select
                            className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                            value={gender}
                            onChange={(e) => setGender(e.target.value)}
                        >
                            <option value="All">No Filter (Any Gender)</option>
                            <option value="male">Male (Inferred from First Name)</option>
                            <option value="female">Female (Inferred from First Name)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            ℹ️ Uses first name analysis since 'gender' column is missing.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Source Filter</label>
                        <select
                            className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                            value={campaignSource}
                            onChange={(e) => setCampaignSource(e.target.value)}
                        >
                            <option value="All">All Enabled Sources</option>
                            {availableSources.map(s => (
                                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Number of Leads</label>
                        <input
                            type="number"
                            min="1"
                            max="10000"
                            className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                            value={limit}
                            onChange={(e) => setLimit(parseInt(e.target.value) || 100)}
                            required
                        />
                        <div className="flex items-center mt-2">
                            <input
                                id="stopToggle"
                                type="checkbox"
                                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                checked={stopOnLimitReached}
                                onChange={(e) => setStopOnLimitReached(e.target.checked)}
                            />
                            <label htmlFor="stopToggle" className="ml-2 block text-sm text-gray-900">
                                Stop verifying when target reached
                            </label>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            {stopOnLimitReached
                                ? "Will stop immediately once we have enough clean leads (saves credits)."
                                : "Will verify all candidates in the batch even if target is exceeded (builds larger pool)."
                            }
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                    >
                        {loading ? '⏳ Generating...' : '⚡ Quick Generate'}
                    </button>
                </form>

                {result && (
                    <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                        <p className="text-green-800 font-medium">✅ List "{result.listName}" generated!</p>
                        <ul className="mt-2 text-sm text-gray-700 space-y-1">
                            <li>🔹 Requested: <strong>{result.requested}</strong></li>
                            <li>🔸 BigQuery Fetched: <strong>{result.stats?.totalFetched}</strong></li>
                            <li>🔸 Local Filtered: <strong>{result.stats?.totalCandidatesAfterLocalFilter ?? '?'}</strong></li>
                            <li>🔸 Sent to Reoon: <strong>{result.stats?.totalSentToReoon ?? '?'}</strong></li>
                            <li>✅ Verified & Stored: <strong className="text-green-700">{result.cleanLeads}</strong></li>
                            {result.stats?.statusBreakdown && (
                                <>
                                    <li className="pt-2 font-semibold text-gray-800">Reoon Breakdown:</li>
                                    {Object.entries(result.stats.statusBreakdown).map(([status, count]) => (
                                        <li key={status}>
                                            {status === 'safe' ? '✅' : status === 'invalid' ? '❌' : status === 'catch_all' ? '📨' : status === 'unknown' ? '❓' : '⚠️'}
                                            {' '}{status}: <strong>{count}</strong>
                                        </li>
                                    ))}
                                </>
                            )}
                            {result.exhausted && <li className="text-orange-600 font-bold italic">⚠️ Source Exhausted</li>}
                        </ul>
                        <button
                            onClick={() => handleExport(result.listName)}
                            className="mt-3 bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition-colors"
                        >
                            📥 Export CSV
                        </button>
                    </div>
                )}

                {error && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-red-800">❌ {error}</p>
                    </div>
                )}
            </div>


            {/* ── Browse Leads ──────────────────────────────────── */}
            <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">🔍 Browse Leads</h2>

                <div className="flex flex-wrap gap-3 items-end mb-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">List Tag</label>
                        <select
                            className="border border-gray-300 rounded p-1.5 text-sm"
                            value={browseTag}
                            onChange={(e) => { setBrowseTag(e.target.value); setLeadsPage(1); }}
                        >
                            <option value="">All</option>
                            {stats.map((s, i) => (
                                <option key={i} value={s.sourceCampaignTag}>{s.sourceCampaignTag}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
                        <select
                            className="border border-gray-300 rounded p-1.5 text-sm"
                            value={browseSource}
                            onChange={(e) => { setBrowseSource(e.target.value); setLeadsPage(1); }}
                        >
                            <option value="">All</option>
                            {filterOptions.sources.map(s => (
                                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Industry</label>
                        <input
                            type="text"
                            list="industry-options"
                            className="border border-gray-300 rounded p-1.5 text-sm w-44"
                            placeholder="Type or select..."
                            value={browseIndustry}
                            onChange={(e) => { setBrowseIndustry(e.target.value); setLeadsPage(1); }}
                        />
                        <datalist id="industry-options">
                            {filterOptions.industries.map(s => (
                                <option key={s} value={s} />
                            ))}
                        </datalist>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Job Title</label>
                        <input
                            type="text"
                            list="jobtitle-options"
                            className="border border-gray-300 rounded p-1.5 text-sm w-44"
                            placeholder="Type or select..."
                            value={browseJobTitle}
                            onChange={(e) => { setBrowseJobTitle(e.target.value); setLeadsPage(1); }}
                        />
                        <datalist id="jobtitle-options">
                            {filterOptions.jobTitles.map(s => (
                                <option key={s} value={s} />
                            ))}
                        </datalist>
                    </div>
                    <button
                        onClick={fetchLeads}
                        disabled={loadingLeads}
                        className="bg-gray-700 text-white px-4 py-1.5 rounded text-sm hover:bg-gray-800 disabled:bg-gray-400"
                    >
                        {loadingLeads ? 'Loading...' : '🔍 Load Leads'}
                    </button>
                    <button
                        onClick={() => { setBrowseTag(''); setBrowseSource(''); setBrowseIndustry(''); setBrowseJobTitle(''); setLeadsPage(1); }}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 border border-gray-200 rounded"
                    >
                        ✕ Clear Filters
                    </button>
                    <button
                        onClick={() => handleExport()}
                        className="bg-green-600 text-white px-4 py-1.5 rounded text-sm hover:bg-green-700"
                    >
                        📥 Export CSV
                    </button>
                </div>

                {leads.length > 0 && (
                    <>
                        <p className="text-xs text-gray-500 mb-2">
                            Showing {leads.length} of {leadsTotal} leads (page {leadsPage})
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left p-2">ID</th>
                                        <th className="text-left p-2">Email</th>
                                        <th className="text-left p-2">Name</th>
                                        <th className="text-left p-2">Gender</th>
                                        <th className="text-left p-2">Source</th>
                                        <th className="text-left p-2">List</th>
                                        <th className="text-left p-2">Verified</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {leads.map(lead => (
                                        <tr key={lead.id} className="border-b hover:bg-gray-50">
                                            <td className="p-2 text-gray-400">{lead.id}</td>
                                            <td className="p-2 font-mono">{lead.email}</td>
                                            <td className="p-2">{lead.firstName}{lead.lastName ? ` ${lead.lastName}` : ''}</td>
                                            <td className="p-2">{lead.gender || '-'}</td>
                                            <td className="p-2">
                                                <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700" title={lead.sourceDetail || ''}>
                                                    {lead.source || '-'}
                                                </span>
                                            </td>
                                            <td className="p-2 font-mono">{lead.sourceCampaignTag}</td>
                                            <td className="p-2">
                                                <span className={`px-1.5 py-0.5 rounded text-xs ${lead.verifiedStatus === 'safe' ? 'bg-green-100 text-green-700' :
                                                    lead.verifiedStatus === 'risky' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-gray-100 text-gray-600'
                                                    }`}>
                                                    {lead.verifiedStatus || '-'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="flex justify-between items-center mt-3">
                            <button
                                onClick={() => { setLeadsPage(p => Math.max(1, p - 1)); }}
                                disabled={leadsPage <= 1}
                                className="text-sm px-3 py-1 border rounded disabled:opacity-30"
                            >
                                ← Prev
                            </button>
                            <span className="text-xs text-gray-500">Page {leadsPage}</span>
                            <button
                                onClick={() => { setLeadsPage(p => p + 1); }}
                                disabled={leads.length < 50}
                                className="text-sm px-3 py-1 border rounded disabled:opacity-30"
                            >
                                Next →
                            </button>
                        </div>
                    </>
                )}

                {leads.length === 0 && !loadingLeads && (
                    <p className="text-gray-400 italic text-sm">Click &quot;Load Leads&quot; to browse.</p>
                )}
            </div>

            {/* ── Lead Stats (collapsed by default, paginated) ────── */}
            <div className="bg-white shadow rounded-lg p-4 border border-gray-200">
                {/* Collapsed header: always visible */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-gray-700">📊 Lead Stats</h3>
                        <span className="text-xs text-gray-500">
                            {stats.length} lists · {stats.reduce((sum, s) => sum + (s.total || 0), 0).toLocaleString()} total leads
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchStats}
                            className="text-xs text-blue-600 hover:text-blue-800"
                        >
                            🔄
                        </button>
                        <button
                            onClick={() => { setStatsExpanded(v => !v); setStatsPage(1); }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 border border-blue-200 rounded hover:bg-blue-50"
                        >
                            {statsExpanded ? '▲ Hide' : '▼ Show Details'}
                        </button>
                    </div>
                </div>

                {/* Expanded: paginated table */}
                {statsExpanded && (
                    <div className="mt-3">
                        {stats.length === 0 ? (
                            <p className="text-gray-500 italic text-sm">No leads generated yet.</p>
                        ) : (
                            <>
                                <div className="overflow-x-auto max-h-[500px] overflow-y-auto border rounded">
                                    <table className="w-full text-sm">
                                        <thead className="sticky top-0 bg-gray-50">
                                            <tr className="border-b">
                                                <th className="text-left p-2 font-medium text-gray-600 text-xs">List Name</th>
                                                <th className="text-right p-2 font-medium text-gray-600 text-xs">Total Leads</th>
                                                <th className="text-center p-2 font-medium text-gray-600 text-xs">Export</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {stats.slice((statsPage - 1) * STATS_PER_PAGE, statsPage * STATS_PER_PAGE).map((s, i) => (
                                                <tr key={i} className="border-b hover:bg-gray-50">
                                                    <td className="p-2 font-mono text-xs">{s.sourceCampaignTag}</td>
                                                    <td className="p-2 text-right font-semibold text-xs">{s.total}</td>
                                                    <td className="p-2 text-center">
                                                        <button
                                                            onClick={() => handleExport(s.sourceCampaignTag)}
                                                            className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200"
                                                        >
                                                            📥 CSV
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination */}
                                {stats.length > STATS_PER_PAGE && (
                                    <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                                        <button
                                            onClick={() => setStatsPage(p => Math.max(1, p - 1))}
                                            disabled={statsPage <= 1}
                                            className="px-2 py-1 border rounded disabled:opacity-30 hover:bg-gray-100"
                                        >
                                            ← Prev
                                        </button>
                                        <span>
                                            Page {statsPage} of {Math.ceil(stats.length / STATS_PER_PAGE)} ({stats.length} lists)
                                        </span>
                                        <button
                                            onClick={() => setStatsPage(p => Math.min(Math.ceil(stats.length / STATS_PER_PAGE), p + 1))}
                                            disabled={statsPage >= Math.ceil(stats.length / STATS_PER_PAGE)}
                                            className="px-2 py-1 border rounded disabled:opacity-30 hover:bg-gray-100"
                                        >
                                            Next →
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ── Top Industries Modal ──────────────────────────── */}
            {showIndustryModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowIndustryModal(false)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800">📊 Top Industries</h3>
                                <p className="text-xs text-gray-500">From BigQuery master_leads — click to select</p>
                            </div>
                            <button onClick={() => setShowIndustryModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                        </div>
                        <div className="px-4 pt-3">
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-md p-2 text-sm"
                                placeholder="🔍 Search industries..."
                                value={industrySearch}
                                onChange={(e) => setIndustrySearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {industriesLoading ? (
                                <div className="text-center py-8 text-gray-500">
                                    <div className="animate-spin inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full mb-2"></div>
                                    <p>Querying BigQuery...</p>
                                </div>
                            ) : topIndustries.length === 0 ? (
                                <p className="text-center text-gray-500 py-8">No industries found.</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 border-b sticky top-0">
                                            <th className="text-left p-2 font-medium text-gray-600">Industry</th>
                                            <th className="text-right p-2 font-medium text-gray-600">Leads</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topIndustries
                                            .filter(i => !industrySearch || i.industry.toLowerCase().includes(industrySearch.toLowerCase()))
                                            .map((item, idx) => (
                                                <tr
                                                    key={idx}
                                                    className="border-b hover:bg-indigo-50 cursor-pointer transition-colors"
                                                    onClick={() => {
                                                        setListIndustry(item.industry);
                                                        setShowIndustryModal(false);
                                                    }}
                                                >
                                                    <td className="p-2 text-gray-800">{item.industry}</td>
                                                    <td className="p-2 text-right text-gray-500 font-mono">{item.rows.toLocaleString()}</td>
                                                </tr>
                                            ))
                                        }
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}
