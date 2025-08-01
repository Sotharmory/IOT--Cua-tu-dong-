import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

interface AccessRequest {
  id: number;
  guest_id: number;
  status: 'pending' | 'approved' | 'rejected';
  expires_at: string;
  created_at: string;
  reason?: string;
  access_type?: string;
  nfc_card_id?: string;
  pin_code?: string;
}

interface AccessLog {
  id: number;
  user_name: string;
  user_id?: number;
  code: string;
  method: 'esp32_pin' | 'esp32_nfc' | 'password' | 'nfc';
  time: string;
  success: boolean;
}

export function GuestDashboard() {
  const { user, logout } = useAuth();
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>([]);
  const [requestReason, setRequestReason] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchAccessRequests();
    fetchAccessLogs();
  }, []);

  const fetchAccessRequests = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('http://165.232.169.151:3000/api/guest/my-requests', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setAccessRequests(data);
      }
    } catch (error) {
      console.error('Error fetching access requests:', error);
    }
  };

  const fetchAccessLogs = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('http://165.232.169.151:3000/api/guest/my-logs', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setAccessLogs(data.logs || data);
      }
    } catch (error) {
      console.error('Error fetching access logs:', error);
    }
  };

  const submitAccessRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`http://165.232.169.151:3000/api/guest/request-nfc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          expires_at: expirationDate,
          reason: requestReason,
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setMessage('Access request submitted successfully!');
        setRequestReason('');
        setExpirationDate('');
        fetchAccessRequests(); // Refresh the list
      } else {
        setMessage(data.error || 'Failed to submit request');
      }
    } catch (error) {
      setMessage('Error submitting request');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'text-green-600 bg-green-100';
      case 'rejected': return 'text-red-600 bg-red-100';
      default: return 'text-yellow-600 bg-yellow-100';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-md">
        <div className="container mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-800">Guest Dashboard</h1>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600">
                Welcome, {user?.username}
              </span>
              <button
                onClick={logout}
                className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Request Access Form */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Request Access</h2>
            
            <form onSubmit={submitAccessRequest} className="space-y-4">
              <div>
                <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for Access
                </label>
                <textarea
                  id="reason"
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="Please explain why you need access..."
                  required
                />
              </div>

              <div>
                <label htmlFor="expiration" className="block text-sm font-medium text-gray-700 mb-2">
                  Requested Expiration Date
                </label>
                <input
                  type="datetime-local"
                  id="expiration"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min={new Date().toISOString().slice(0, 16)}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>

            {message && (
              <div className={`mt-4 p-3 rounded-md ${
                message.includes('successfully') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {message}
              </div>
            )}
          </div>

          {/* My Requests */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">My Access Requests</h2>
            
            {accessRequests.length === 0 ? (
              <p className="text-gray-500">No requests yet. Submit your first request!</p>
            ) : (
              <div className="space-y-4">
                {accessRequests.map((request: AccessRequest) => (
                  <div key={request.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(request.status)}`}>
                        {request.status.toUpperCase()}
                      </span>
                      <span className="text-sm text-gray-500">
                        {new Date(request.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-600">
                      <p><strong>Expires:</strong> {new Date(request.expires_at).toLocaleDateString()}</p>
                      {request.reason && (
                        <p className="mt-1"><strong>Reason:</strong> {request.reason}</p>
                      )}
                      {request.status === 'approved' && (
                        <div className="mt-2 p-2 bg-green-50 rounded">
                          {request.nfc_card_id && (
                            <p><strong>NFC Card ID:</strong> <code className="bg-gray-100 px-2 py-1 rounded">{request.nfc_card_id}</code></p>
                          )}
                          {request.pin_code && (
                            <p><strong>PIN Code:</strong> <code className="bg-gray-100 px-2 py-1 rounded">{request.pin_code}</code></p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Personal Access History */}
        <div className="mt-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <span>📋</span>
            My Access History
          </h2>
          
          {accessLogs.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-400 text-4xl mb-4">🔍</div>
              <p className="text-gray-500">No access attempts yet.</p>
              <p className="text-gray-400 text-sm mt-2">Your unlock attempts will appear here once you start using the system.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-auto">
                <thead>
                  <tr className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
                    <th className="text-left py-3 px-4 font-semibold text-sm">🔑 Code/Card ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">🔧 Method</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">⏰ Time</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">🎯 Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {accessLogs.map((log, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-sm bg-gray-50 rounded">{log.code}</td>
                      <td className="py-3 px-4 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          log.method === 'esp32_pin' ? 'bg-blue-100 text-blue-800' :
                          log.method === 'esp32_nfc' ? 'bg-purple-100 text-purple-800' :
                          log.method === 'password' ? 'bg-green-100 text-green-800' :
                          log.method === 'nfc' ? 'bg-orange-100 text-orange-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {log.method === 'esp32_pin' ? '📱 ESP32 PIN' :
                           log.method === 'esp32_nfc' ? '📱 ESP32 NFC' :
                           log.method === 'password' ? '🔢 Web Password' :
                           log.method === 'nfc' ? '📟 Web NFC' :
                           log.method}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-700">
                        {new Date(log.time).toLocaleString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 w-fit ${
                          log.success 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          <span>{log.success ? '✅' : '❌'}</span>
                          <span>{log.success ? 'Success' : 'Failed'}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              <div className="mt-4 text-sm text-gray-500 flex items-center justify-between">
                <span>📊 Total attempts: {accessLogs.length}</span>
                <span>✅ Successful: {accessLogs.filter(log => log.success).length}</span>
                <span>❌ Failed: {accessLogs.filter(log => !log.success).length}</span>
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">How it works</h3>
          <ul className="text-blue-700 space-y-1">
            <li>• Submit a request for access with a reason and expiration date</li>
            <li>• An administrator will review your request</li>
            <li>• Once approved, you'll receive either an NFC card ID or PIN code (or both)</li>
            <li>• Use the provided credentials to access the system</li>
            <li>• Access will automatically expire on the date you specified</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
