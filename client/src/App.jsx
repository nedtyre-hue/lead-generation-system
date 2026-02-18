import { useState, useEffect } from 'react'
import API_BASE from './config'
import Settings from './pages/Settings'
import Dashboard from './pages/Dashboard'
import MyLists from './pages/MyLists'

function App() {
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'lists' | 'settings'
  const [status, setStatus] = useState('Checking...');
  const [isServerUp, setIsServerUp] = useState(false);
  const [initialListFilter, setInitialListFilter] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then(res => res.json())
      .then(data => {
        setStatus('Online');
        setIsServerUp(true);
      })
      .catch(err => {
        setStatus('Offline (' + err.message + ')');
        setIsServerUp(false);
      });
  }, []);

  // Called from MyLists "Browse" button — switches to Dashboard with the list pre-selected
  const handleOpenList = (listName) => {
    setInitialListFilter(listName);
    setView('dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Navbar */}
      <nav className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-blue-600 mr-8">LeadManager</span>
              <div className="hidden sm:flex space-x-8">
                <button
                  onClick={() => setView('dashboard')}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${view === 'dashboard' ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setView('lists')}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${view === 'lists' ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  📋 My Lists
                </button>
                <button
                  onClick={() => setView('settings')}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${view === 'settings' ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  Settings
                </button>
              </div>
            </div>
            <div className="flex items-center">
              <span className={`text-xs px-2 py-1 rounded ${isServerUp ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                Server: {status}
              </span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {view === 'settings' && <Settings />}
        {view === 'lists' && <MyLists onOpenList={handleOpenList} />}
        {view === 'dashboard' && <Dashboard initialListFilter={initialListFilter} onClearListFilter={() => setInitialListFilter('')} />}
      </main>
    </div>
  )
}

export default App
