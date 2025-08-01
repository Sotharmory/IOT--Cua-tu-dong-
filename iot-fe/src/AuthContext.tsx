import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';

const API_URL = 'http://165.232.169.151:3000/api';

interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  type: 'admin' | 'guest';
  role?: string;
  phone?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string, userType: 'admin' | 'guest') => Promise<void>;
  register: (userData: RegisterData) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

interface RegisterData {
  username: string;
  email?: string;
  password: string;
  full_name: string;
  phone?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state from localStorage
  useEffect(() => {
    const initAuth = async () => {
      const savedToken = localStorage.getItem('authToken');
      const savedUser = localStorage.getItem('authUser');

      if (savedToken && savedUser) {
        try {
          // Verify token is still valid
          const response = await axios.post(`${API_URL}/auth/verify`, {}, {
            headers: { Authorization: `Bearer ${savedToken}` }
          });

          if (response.data.success) {
            setToken(savedToken);
            setUser(JSON.parse(savedUser));
          } else {
            // Token invalid, clear storage
            localStorage.removeItem('authToken');
            localStorage.removeItem('authUser');
          }
        } catch (error) {
          // Token invalid, clear storage
          localStorage.removeItem('authToken');
          localStorage.removeItem('authUser');
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async (username: string, password: string, userType: 'admin' | 'guest') => {
    setIsLoading(true);
    try {
      const endpoint = userType === 'admin' ? '/auth/admin/login' : '/auth/guest/login';
      const response = await axios.post(`${API_URL}${endpoint}`, {
        username,
        password
      });

      if (response.data.success) {
        const { user: userData, token: userToken } = response.data;
        
        setUser(userData);
        setToken(userToken);
        
        localStorage.setItem('authToken', userToken);
        localStorage.setItem('authUser', JSON.stringify(userData));
      } else {
        throw new Error(response.data.error || 'Login failed');
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(error.response?.data?.error || 'Login failed');
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: RegisterData) => {
    setIsLoading(true);
    try {
      // Only allow guest registration
      const response = await axios.post(`${API_URL}/auth/guest/register`, userData);

      if (response.data.success) {
        // Registration successful but requires approval
        if (response.data.requiresApproval) {
          throw new Error('Registration successful! Your account is pending admin approval. You will be able to log in once approved.');
        }
        
        // If auto-approval is enabled (shouldn't happen with new flow)
        const { user: newUser, token: userToken } = response.data;
        
        setUser(newUser);
        setToken(userToken);
        
        localStorage.setItem('authToken', userToken);
        localStorage.setItem('authUser', JSON.stringify(newUser));
      } else {
        throw new Error(response.data.error || 'Registration failed');
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(error.response?.data?.error || 'Registration failed');
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await axios.post(`${API_URL}/auth/logout`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (error) {
      // Ignore logout errors
    }

    setUser(null);
    setToken(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
  };

  const refreshToken = async () => {
    if (!token) return;

    try {
      const response = await axios.post(`${API_URL}/auth/refresh`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        const newToken = response.data.token;
        setToken(newToken);
        localStorage.setItem('authToken', newToken);
      }
    } catch (error) {
      // If refresh fails, logout user
      logout();
    }
  };

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    login,
    register,
    logout,
    refreshToken
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Helper hook for API calls with authentication
export const useAuthAPI = () => {
  const { token } = useAuth();

  const apiCall = async (url: string, options: any = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return axios({
      url: `${API_URL}${url}`,
      ...options,
      headers
    });
  };

  return { apiCall };
};
