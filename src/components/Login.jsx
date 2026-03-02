import { useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useAuth } from '../context/AuthContext';
import '../styles/Login.scss';

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

<<<<<<< HEAD
    const result = await login(username, password);
=======
    // This calls the login function in your AuthContext.jsx
    const result = await login(email, password);
>>>>>>> 005b8ca (feat: login eye toggle and dashboard updates)

    if (!result.success) {
      setError(result.error || 'Login failed');
      setLoading(false);
    }
    // If success, AuthContext will update and the App will redirect you automatically
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

          {/* EMAIL FIELD */}
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

          {/* PASSWORD FIELD WITH EYE TOGGLE */}
          <div className="form-group">
            <label htmlFor="password">Password</label>
<<<<<<< HEAD
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
=======
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                id="password"
                // This switches between dots and text
                type={showPassword ? "text" : "password"} 
>>>>>>> 005b8ca (feat: login eye toggle and dashboard updates)
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
                autoComplete="current-password"
<<<<<<< HEAD
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((previousValue) => !previousValue)}
                disabled={loading}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <MdVisibilityOff /> : <MdVisibility />}
=======
                style={{ width: '100%', paddingRight: '45px' }} 
              />
              
              <button
                type="button"
                // This toggles the showPassword true/false
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '5px'
                }}
              >
                {showPassword ? "🙈" : "👁️"}
>>>>>>> 005b8ca (feat: login eye toggle and dashboard updates)
              </button>
            </div>
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