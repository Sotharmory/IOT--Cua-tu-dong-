import React, { useState } from 'react';
import { useAuth } from './AuthContext';

interface LoginFormProps {
  onClose?: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onClose }) => {
  const { login, register, isLoading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [userType, setUserType] = useState<'admin' | 'guest'>('guest');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    phone: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (mode === 'register' && formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (mode === 'register' && formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    try {
      if (mode === 'login') {
        await login(formData.username, formData.password, userType);
        setSuccess('Login successful!');
        if (onClose) onClose();
      } else {
        // Registration is always for guest users
        try {
          await register({
            username: formData.username,
            email: formData.email,
            password: formData.password,
            full_name: formData.full_name,
            phone: formData.phone
          });
          // This won't execute due to approval requirement
          setSuccess('Registration successful! You are now logged in.');
          if (onClose) onClose();
        } catch (err) {
          // Check if it's the approval message
          const errorMessage = err instanceof Error ? err.message : 'An error occurred';
          if (errorMessage.includes('pending admin approval')) {
            setSuccess(errorMessage);
            // Clear form
            setFormData({
              username: '',
              email: '',
              password: '',
              confirmPassword: '',
              full_name: '',
              phone: ''
            });
            // Switch back to login mode after a delay
            setTimeout(() => {
              setMode('login');
              setSuccess('');
            }, 5000);
          } else {
            setError(errorMessage);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-md mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          {mode === 'login' ? '🔐 Sign In' : '📝 Sign Up'}
        </h2>
        <p className="text-gray-600 mt-2">
          {mode === 'login' 
            ? 'Welcome back! Please sign in to your account.' 
            : 'Create a new account to get started.'
          }
        </p>
      </div>

      {/* Toggle buttons */}
      <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
            mode === 'login'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('register');
            setUserType('guest'); // Force guest type for registration
          }}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
            mode === 'register'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Sign Up
        </button>
      </div>

      {/* User type selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Account Type</label>
        <select
          name="userType"
          value={userType}
          onChange={(e) => setUserType(e.target.value as 'admin' | 'guest')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="guest">👤 Guest User</option>
          {mode === 'login' && <option value="admin">👑 Administrator</option>}
        </select>
        {mode === 'register' && (
          <p className="text-xs text-gray-500 mt-1">
            Note: New accounts are created as guest users. Contact an administrator for admin access.
          </p>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          ❌ {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
          ✅ {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Username */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Username *
          </label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleInputChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your username"
          />
        </div>

        {/* Email (for registration) */}
        {mode === 'register' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email {userType === 'admin' ? '*' : '(Optional)'}
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              required={userType === 'admin'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your email"
            />
          </div>
        )}

        {/* Full Name (for registration) */}
        {mode === 'register' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name *
            </label>
            <input
              type="text"
              name="full_name"
              value={formData.full_name}
              onChange={handleInputChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your full name"
            />
          </div>
        )}

        {/* Phone (for guest registration) */}
        {mode === 'register' && userType === 'guest' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone (Optional)
            </label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your phone number"
            />
          </div>
        )}

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Password *
          </label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleInputChange}
            required
            minLength={mode === 'register' ? 6 : undefined}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your password"
          />
        </div>

        {/* Confirm Password (for registration) */}
        {mode === 'register' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password *
            </label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleInputChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Confirm your password"
            />
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white py-3 px-4 rounded-lg font-medium transition-all duration-200 flex items-center justify-center"
        >
          {isLoading ? (
            <span className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              {mode === 'login' ? 'Signing In...' : 'Creating Account...'}
            </span>
          ) : (
            <span>
              {mode === 'login' ? '🔐 Sign In' : '📝 Create Account'}
            </span>
          )}
        </button>
      </form>

      {/* Footer */}
      <div className="mt-6 text-center text-sm text-gray-600">
        {mode === 'login' ? (
          <p>
            Don't have an account?{' '}
            <button
              type="button"
              onClick={() => setMode('register')}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Sign up here
            </button>
          </p>
        ) : (
          <p>
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => setMode('login')}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Sign in here
            </button>
          </p>
        )}
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      )}
    </div>
  );
};
