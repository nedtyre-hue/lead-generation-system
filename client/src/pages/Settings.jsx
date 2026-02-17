import { useState, useEffect } from 'react';
import API_BASE from '../config';

export default function Settings() {
    const [settings, setSettings] = useState({
        bq_project_id: '',
        bq_dataset: '',
        bq_table: '',
        bq_query_template: 'SELECT email, first_name FROM `project.dataset.table` WHERE ...',
        reoon_api_key: '',
        reoon_statuses: '["safe"]',
        manyreach_api_key: '',
        manyreach_list_id: '',
        manyreach_batch_size: '100',
        manyreach_batch_delay: '1000',
        manyreach_retry_delay: '30000',
        enabled_sources: '[]'
    });
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');

    // Reoon status options — check 'catch_all' if you want to accept catch-all domains for outbound
    const statusOptions = ['safe', 'catch_all', 'risky', 'unknown', 'invalid', 'disabled'];

    useEffect(() => {
        fetch(`${API_BASE}/api/settings`)
            .then(res => res.json())
            .then(data => {
                if (Object.keys(data).length > 0) {
                    setSettings(prev => ({ ...prev, ...data }));
                }
                setLoading(false);
            })
            .catch(err => {
                setMessage('Error loading settings: ' + err.message);
                setLoading(false);
            });
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings(prev => ({ ...prev, [name]: value }));
    };

    const handleStatusChange = (status) => {
        let currentStatuses = [];
        try {
            currentStatuses = JSON.parse(settings.reoon_statuses || '[]');
        } catch (e) {
            currentStatuses = [];
        }

        if (currentStatuses.includes(status)) {
            currentStatuses = currentStatuses.filter(s => s !== status);
        } else {
            currentStatuses.push(status);
        }
        setSettings(prev => ({ ...prev, reoon_statuses: JSON.stringify(currentStatuses) }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        setLoading(true);
        fetch(`${API_BASE}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        })
            .then(res => res.json())
            .then(() => {
                setMessage('Settings saved successfully!');
                setLoading(false);
                setTimeout(() => setMessage(''), 3000);
            })
            .catch(err => {
                setMessage('Error saving settings: ' + err.message);
                setLoading(false);
            });
    };

    if (loading && !settings.bq_project_id) return <div className="p-8">Loading...</div>;

    return (
        <div className="p-6 max-w-4xl mx-auto bg-white rounded shadow">
            <h2 className="text-2xl font-bold mb-6">Configuration</h2>

            {message && (
                <div className={`p-4 mb-4 rounded ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {message}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">

                {/* BigQuery Section */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold border-b pb-2">BigQuery Settings</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Project ID</label>
                            <input type="text" name="bq_project_id" value={settings.bq_project_id} onChange={handleChange} className="w-full border p-2 rounded" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Dataset</label>
                            <input type="text" name="bq_dataset" value={settings.bq_dataset} onChange={handleChange} className="w-full border p-2 rounded" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Table Name</label>
                            <input type="text" name="bq_table" value={settings.bq_table} onChange={handleChange} className="w-full border p-2 rounded" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Base Query Template</label>
                        <textarea
                            name="bq_query_template"
                            value={settings.bq_query_template}
                            onChange={handleChange}
                            className="w-full border p-2 rounded h-32 font-mono text-sm"
                            placeholder="SELECT email, first_name FROM `project.dataset.table` WHERE 1=1"
                        />
                        <p className="text-xs text-gray-500 mt-1">Use standard SQL. The app will append LIMIT/OFFSET if needed.</p>
                    </div>
                </div>
                <div>
                    <button
                        type="button"
                        onClick={() => {
                            setLoading(true);
                            setMessage('Testing BigQuery connection...');
                            fetch(`${API_BASE}/api/settings/test-bigquery`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(settings)
                            })
                                .then(res => res.json())
                                .then(data => {
                                    setLoading(false);
                                    if (data.success) {
                                        setMessage('✅ ' + data.message);
                                    } else {
                                        setMessage('❌ Test Failed: ' + data.error);
                                    }
                                })
                                .catch(err => {
                                    setLoading(false);
                                    setMessage('network error: ' + err.message);
                                });
                        }}
                        className="mt-2 bg-gray-600 text-white px-4 py-1 text-sm rounded hover:bg-gray-700"
                    >
                        🔌 Test BigQuery Connection
                    </button>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Enabled Sources</label>
                    <input type="text" name="enabled_sources" value={settings.enabled_sources || '[]'} onChange={handleChange} className="w-full border p-2 rounded font-mono text-sm" placeholder='["leadrocks","apollo","linkedin"]' />
                    <p className="text-xs text-gray-500 mt-1">JSON array of source codes to filter by. Empty [] = all sources allowed. Example: ["leadrocks","apollo"]</p>
                </div>


                {/* Reoon Section */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold border-b pb-2">Reoon Verification</h3>
                    <div>
                        <label className="block text-sm font-medium mb-1">API Key</label>
                        <input type="password" name="reoon_api_key" value={settings.reoon_api_key} onChange={handleChange} className="w-full border p-2 rounded" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-2">Acceptable Statuses</label>
                        <div className="flex gap-4">
                            {statusOptions.map(status => {
                                const currentStatuses = JSON.parse(settings.reoon_statuses || '[]');
                                return (
                                    <label key={status} className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            checked={currentStatuses.includes(status)}
                                            onChange={() => handleStatusChange(status)}
                                        />
                                        <span className="capitalize">{status}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* ManyReach Section (Disabled) */}
                <div className="space-y-2 opacity-50">
                    <h3 className="text-lg font-semibold border-b pb-2 text-gray-400">ManyReach Settings
                        <span className="ml-2 text-xs font-normal bg-gray-200 text-gray-500 px-2 py-0.5 rounded">Not used in this version</span>
                    </h3>
                    <p className="text-xs text-gray-400">
                        ManyReach integration is disabled. Export leads as CSV and upload manually.
                        API key is stored for future use but not called.
                    </p>
                </div>

                <div className="pt-4">
                    <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-medium">Save Settings</button>
                </div>

            </form >
        </div >
    );
}
