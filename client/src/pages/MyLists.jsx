import { useState, useEffect, useRef } from 'react';
import API_BASE from '../config';

export default function MyLists({ onOpenList }) {
    const [lists, setLists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchLists();
    }, []);

    async function fetchLists() {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${API_BASE}/api/lists`);
            if (!res.ok) throw new Error('Failed to load lists');
            const data = await res.json();
            setLists(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const exportingRef = useRef(false);
    const handleExport = async (listName) => {
        if (exportingRef.current) return;
        exportingRef.current = true;

        const params = new URLSearchParams();
        params.set('sourceCampaignTag', listName);

        try {
            const url = `${API_BASE}/api/leads/export?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Export failed');

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const filename = `${listName}-${Date.now()}.csv`;

            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } catch (err) {
            console.error('Export error:', err);
            alert('CSV export failed: ' + err.message);
        } finally {
            exportingRef.current = false;
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white shadow rounded-lg p-6 border-l-4 border-blue-500">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-800">
                            📋 My Lists
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            All lead lists you've generated. Click to export or browse.
                        </p>
                    </div>
                    <button
                        onClick={fetchLists}
                        disabled={loading}
                        className="text-sm bg-blue-100 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-200 disabled:bg-gray-200 transition-colors"
                    >
                        🔄 Refresh
                    </button>
                </div>

                {loading && (
                    <div className="flex items-center gap-2 py-8 justify-center">
                        <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                        <span className="text-gray-500">Loading lists...</span>
                    </div>
                )}

                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-red-800">❌ {error}</p>
                    </div>
                )}

                {!loading && !error && lists.length === 0 && (
                    <div className="text-center py-8 text-gray-400">
                        <p className="text-lg">No lists yet</p>
                        <p className="text-sm mt-1">Go to Dashboard → Generate Lead List to create your first list.</p>
                    </div>
                )}

                {!loading && !error && lists.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        List Name
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Total Leads
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Clean (Safe)
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Created
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Last Updated
                                    </th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {lists.map((list) => (
                                    <tr key={list.listName} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <span className="text-sm font-medium text-gray-900">{list.listName}</span>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-right">
                                            <span className="text-sm font-semibold text-blue-700">{list.totalLeads.toLocaleString()}</span>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-right">
                                            <span className={`text-sm font-semibold ${list.cleanLeads > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                                                {list.cleanLeads.toLocaleString()}
                                            </span>
                                            {list.totalLeads > 0 && list.cleanLeads > 0 && (
                                                <span className="text-xs text-gray-400 ml-1">
                                                    ({Math.round(list.cleanLeads / list.totalLeads * 100)}%)
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                            {formatDate(list.createdAt)}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                            {formatDate(list.lastUpdatedAt)}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleExport(list.listName)}
                                                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
                                                    title="Download this list as CSV"
                                                >
                                                    📥 Export CSV
                                                </button>
                                                <button
                                                    onClick={() => onOpenList(list.listName)}
                                                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors border border-gray-300"
                                                    title="Browse leads in this list"
                                                >
                                                    🔍 Browse
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {!loading && lists.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center text-xs text-gray-400">
                        <span>{lists.length} list{lists.length !== 1 ? 's' : ''} total</span>
                        <span>
                            {lists.reduce((sum, l) => sum + l.totalLeads, 0).toLocaleString()} total leads
                            {' · '}
                            {lists.reduce((sum, l) => sum + l.cleanLeads, 0).toLocaleString()} clean
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
