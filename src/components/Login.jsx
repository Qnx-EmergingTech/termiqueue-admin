import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/Login.scss';

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, authNotice, clearAuthNotice } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    clearAuthNotice();
    setLoading(true);

    if (!username || !password) {
      setError('Please enter both username/email and password');
      setLoading(false);
      return;
    }

    const result = await login(username, password);

    if (!result.success) {
      setError(result.error);
      setLoading(false);
    }
    // If success, AuthContext will update and App will redirect
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <h1>QNext Admin</h1>
          <p>Sign in to access your dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {authNotice && (
            <div className="error-message">
              {authNotice}
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">Username or Email</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username or email"
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <button 
            type="submit" 
            className="login-button"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="login-footer">
          <p className="demo-info">
            <strong>Demo Mode:</strong> Enter any username/email and password to login
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
