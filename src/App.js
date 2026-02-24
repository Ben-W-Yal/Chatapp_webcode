import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import YouTubeDownload from './components/YouTubeDownload';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('chatapp_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState('chat');

  const handleLogin = (userData) => {
    const u = typeof userData === 'string' ? { username: userData, firstName: '', lastName: '' } : userData;
    localStorage.setItem('chatapp_user', JSON.stringify(u));
    setUser(u);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
  };

  if (user) {
    return (
      <div className="app-with-tabs">
        <nav className="app-tabs">
          <button
            className={activeTab === 'chat' ? 'active' : ''}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button
            className={activeTab === 'youtube' ? 'active' : ''}
            onClick={() => setActiveTab('youtube')}
          >
            YouTube Channel Download
          </button>
          <button className="app-logout" onClick={handleLogout}>
            Log out
          </button>
        </nav>
        {activeTab === 'chat' && <Chat user={user} onLogout={handleLogout} />}
        {activeTab === 'youtube' && <YouTubeDownload />}
      </div>
    );
  }
  return <Auth onLogin={handleLogin} />;
}

export default App;
