import { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { LoginForm } from './LoginForm';
import { GuestDashboard } from './GuestDashboard';

const API_URL = 'http://165.232.169.151:3000/api';
console.log('API_URL constant loaded:', API_URL);

// Helper function to get auth headers with JWT token
const getAuthHeaders = () => {
  const token = localStorage.getItem('authToken');
  return {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
};

type Code = { code: string; type: string; expires_at: string };
type Card = { id: string; enrolled_at: string };
type Log = { method: string; code: string; time: string; success: boolean; user_name?: string; user_id?: number };

// ESP32 Types
type ESP32User = {
  id: number;
  name: string;
  pin: string;
  nfc_id: string;
  auth_type: number;
  is_active: number;
  created_at: number;
  synced_to_esp32: number;
};

type ESP32Status = {
  last_sync: number;
  user_count: number;
  failed_attempts: number;
  lockout_time: number;
  is_online: number;
};

// Guest System Types
type GuestAccount = {
  id: number;
  username: string;
  full_name: string;
  email: string;
  phone: string;
  created_at: number;
  is_active: number;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_by: string;
  approved_at: number;
  pin_code?: string;
};

type NFCRequest = {
  id: number;
  guest_id: number;
  guest_name: string;
  username: string;
  email: string;
  phone: string;
  reason: string;
  requested_at: number;
  expires_at: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  admin_notes: string;
  approved_by: string;
  approved_at: number;
  nfc_card_id: string;
  pin_code?: string;
  access_type?: 'pin' | 'nfc';
};

type GuestAuth = {
  id: number;
  username: string;
  full_name: string;
  email: string;
  phone: string;
  authToken: string;
};

export default function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <LoginForm />
      </div>
    );
  }

  return <AuthenticatedApp user={user} />;
}

function AuthenticatedApp({ user }: { user: any }) {
  const { logout } = useAuth();
  
  // Show different dashboards based on user type
  if (user.type === 'guest') {
    return <GuestDashboard />;
  }
  
  // Admin dashboard with existing functionality
  const [code, setCode] = useState('');
  const [ttl, setTtl] = useState(300);
  const [type, setType] = useState('otp');
  const [nfcId, setNfcId] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('unlock'); // unlock, manage, logs, esp32, guests
  const [confirmDelete, setConfirmDelete] = useState<{type: 'code' | 'card', value: string} | null>(null);

  const [codes, setCodes] = useState<Code[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const LOG_LIMIT = 20;
  
  // Log sorting and filtering state
  const [logSortBy, setLogSortBy] = useState('time');
  const [logSortOrder, setLogSortOrder] = useState('desc');
  const [logFilterBy, setLogFilterBy] = useState('');
  const [logFilterValue, setLogFilterValue] = useState('');
  const [dateRangeStart, setDateRangeStart] = useState('');
  const [dateRangeEnd, setDateRangeEnd] = useState('');

  // ESP32 state
  const [esp32Users, setEsp32Users] = useState<ESP32User[]>([]);
  const [esp32Status, setEsp32Status] = useState<ESP32Status>({
    last_sync: 0,
    user_count: 0,
    failed_attempts: 0,
    lockout_time: 0,
    is_online: 0
  });
  const [newUser, setNewUser] = useState({
    name: '',
    pin: '',
    nfc_id: '',
    auth_type: 1
  });

  // Guest System State
  const [guestAuth, setGuestAuth] = useState<GuestAuth | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [guestAccounts, setGuestAccounts] = useState<GuestAccount[]>([]);
  const [pendingUsers, setPendingUsers] = useState<GuestAccount[]>([]);
  const [nfcRequests, setNfcRequests] = useState<NFCRequest[]>([]);
  const [pinAssignment, setPinAssignment] = useState({
    guestId: 0,
    pinCode: '',
    isAssigning: false
  });
  const [newGuestRequest, setNewGuestRequest] = useState({
    reason: '',
    duration_hours: 24
  });
  const [guestLogin, setGuestLogin] = useState({
    username: '',
    password: ''
  });
  const [guestRegister, setGuestRegister] = useState({
    username: '',
    password: '',
    full_name: '',
    email: '',
    phone: ''
  });
  const [responseData, setResponseData] = useState({
    action: 'approve' as 'approve' | 'reject',
    admin_notes: '',
    access_type: 'pin' as 'pin' | 'nfc',
    nfc_card_id: '',
    approved_by: 'Admin'
  });

  const handleCreateCode = async () => {
    if (!code || code.length !== 6) {
      setMessage('Vui lòng nhập mã 6 chữ số hợp lệ');
      return;
    }
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/create-code`, { code, ttlSeconds: Number(ttl), type }, getAuthHeaders());
      setMessage(`✅ Mã ${res.data.code} đã được tạo thành công!`);
      setCode('');
      fetchActive();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Lỗi khi tạo mã'}`);
      } else {
        setMessage('❌ Lỗi khi tạo mã');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCode = async (codeToDelete?: string) => {
    const codeToUse = codeToDelete || code;
    if (!codeToUse) {
      setMessage('Vui lòng nhập mã cần xóa');
      return;
    }
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/delete-code`, { code: codeToUse }, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
      if (!codeToDelete) setCode(''); // Only clear input if not called from code list
      fetchActive();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Lỗi khi xóa mã'}`);
      } else {
        setMessage('❌ Lỗi khi xóa mã');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnlock = async () => {
    if (!code) {
      setMessage('Vui lòng nhập mã để mở khóa');
      return;
    }
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/unlock`, { code }, getAuthHeaders());
      setMessage(`🔓 Đã mở khóa bằng ${res.data.method === 'nfc' ? 'thẻ NFC' : 'mã số'}`);
      setCode('');
      fetchLogs(logPage);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Mở khóa thất bại'}`);
      } else {
        setMessage('❌ Mở khóa thất bại');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnroll = async () => {
    setIsLoading(true);
    try {
      const body = nfcId ? { id: nfcId } : {};
      const res = await axios.post(`${API_URL}/enroll`, body, getAuthHeaders());
      setMessage(`✅ ${res.data.message || `Thẻ ${res.data.id} đã được đăng ký`}`);
      setNfcId('');
      fetchActive();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Đăng ký thẻ thất bại'}`);
      } else {
        setMessage('❌ Đăng ký thẻ thất bại');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisenroll = async (cardId?: string) => {
    const idToUse = cardId || nfcId;
    if (!idToUse) {
      setMessage('Vui lòng nhập ID thẻ cần hủy đăng ký');
      return;
    }
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/disenroll`, { id: idToUse }, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
      if (!cardId) setNfcId(''); // Only clear input if not called from card list
      fetchActive();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Hủy đăng ký thất bại'}`);
      } else {
        setMessage('❌ Hủy đăng ký thất bại');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchActive = async () => {
    try {
      const [passRes, nfcRes] = await Promise.all([
        axios.get(`${API_URL}/active-passwords`, getAuthHeaders()),
        axios.get(`${API_URL}/active-nfc-cards`, getAuthHeaders()),
      ]);
      setCodes(passRes.data);
      setCards(nfcRes.data);
    } catch (err) {
      console.error('Error fetching active items');
    }
  };

  const fetchLogs = async (page: number, resetLogs = false) => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: LOG_LIMIT.toString(),
        sortBy: logSortBy,
        sortOrder: logSortOrder
      });
      
      if (logFilterBy && logFilterValue) {
        params.append('filterBy', logFilterBy);
        params.append('filterValue', logFilterValue);
      }
      
      if (dateRangeStart) {
        params.append('startDate', dateRangeStart);
      }
      
      if (dateRangeEnd) {
        params.append('endDate', dateRangeEnd);
      }
      
      const res = await axios.get(`${API_URL}/logs?${params.toString()}`, getAuthHeaders());
      
      if (page === 1 || resetLogs) {
        setLogs(res.data.logs || res.data);
        setTotalLogs(res.data.total || res.data.length);
      } else {
        setLogs(prev => [...prev, ...(res.data.logs || res.data)]);
      }
    } catch (err) {
      console.error('Lỗi khi tải logs:', err);
    }
  };

  const handleLogSortChange = (newSortBy: string) => {
    if (newSortBy === logSortBy) {
      setLogSortOrder(logSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setLogSortBy(newSortBy);
      setLogSortOrder('desc');
    }
    setLogPage(1);
  };

  const handleLogFilterChange = (filterBy: string, filterValue: string) => {
    setLogFilterBy(filterBy);
    setLogFilterValue(filterValue);
    setLogPage(1);
  };

  const clearLogFilter = () => {
    setLogFilterBy('');
    setLogFilterValue('');
    setDateRangeStart('');
    setDateRangeEnd('');
    setLogPage(1);
  };

  // ESP32 Functions
  const fetchESP32Users = async () => {
    try {
      const res = await axios.get(`${API_URL}/esp32/users`, getAuthHeaders());
      setEsp32Users(res.data);
    } catch (err) {
      console.error('Error fetching ESP32 users:', err);
    }
  };

  const fetchESP32Status = async () => {
    try {
      const res = await axios.get(`${API_URL}/esp32/status`, getAuthHeaders());
      setEsp32Status(res.data);
    } catch (err) {
      console.error('Error fetching ESP32 status:', err);
    }
  };

  const handleAddESP32User = async () => {
    if (!newUser.name || !newUser.pin) {
      setMessage('❌ Name and PIN are required');
      return;
    }

    setIsLoading(true);
    try {
      await axios.post(`${API_URL}/esp32/add-user`, newUser, getAuthHeaders());
      setMessage(`✅ User ${newUser.name} added to ESP32!`);
      setNewUser({ name: '', pin: '', nfc_id: '', auth_type: 1 });
      fetchESP32Users();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Failed to add user'}`);
      } else {
        setMessage('❌ Failed to add user');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveESP32User = async (userId: number) => {
    setIsLoading(true);
    try {
      await axios.post(`${API_URL}/esp32/remove-user`, { userId }, getAuthHeaders());
      setMessage(`✅ User removed from ESP32!`);
      fetchESP32Users();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Failed to remove user'}`);
      } else {
        setMessage('❌ Failed to remove user');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnrollNFC = async (userId: number) => {
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/esp32/enroll-nfc`, { userId }, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Failed to start enrollment'}`);
      } else {
        setMessage('❌ Failed to start enrollment');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignPIN = async (userId: number, currentName: string) => {
    const newPIN = prompt(`Assign new PIN for ${currentName}:\nEnter 4-8 digit PIN:`);
    if (!newPIN) return;
    
    if (!/^\d{4,8}$/.test(newPIN)) {
      setMessage('❌ PIN must be 4-8 digits only');
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/esp32/assign-pin`, { userId, pin: newPIN }, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
      fetchESP32Users();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Failed to assign PIN'}`);
      } else {
        setMessage('❌ Failed to assign PIN');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetESP32 = async () => {
    if (!confirm('Are you sure you want to factory reset the ESP32? This will remove all users!')) {
      return;
    }
    
    setIsLoading(true);
    try {
      await axios.post(`${API_URL}/esp32/reset`, { confirm: 'CONFIRM_RESET' }, getAuthHeaders());
      setMessage(`✅ ESP32 factory reset initiated!`);
      fetchESP32Users();
      fetchESP32Status();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Failed to reset ESP32'}`);
      } else {
        setMessage('❌ Failed to reset ESP32');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ===== GUEST SYSTEM FUNCTIONS =====

  const handleGuestLogin = async () => {
    if (!guestLogin.username || !guestLogin.password) {
      setMessage('❌ Username and password are required');
      return;
    }

    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/guest/login`, guestLogin);
      setGuestAuth(res.data.guest);
      setGuestMode(true);
      setMessage(`✅ Welcome, ${res.data.guest.full_name}!`);
      setGuestLogin({ username: '', password: '' });
      
      // Store auth token for API calls
      localStorage.setItem('guestAuthToken', res.data.authToken);
      
      // Fetch guest's requests
      fetchGuestRequests();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Login failed'}`);
      } else {
        setMessage('❌ Login failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestRegister = async () => {
    if (!guestRegister.username || !guestRegister.password || !guestRegister.full_name) {
      setMessage('❌ Username, password, and full name are required');
      return;
    }

    setIsLoading(true);
    try {
      await axios.post(`${API_URL}/guest/register`, guestRegister);
      setMessage(`✅ Account created successfully! You can now login.`);
      setGuestRegister({
        username: '',
        password: '',
        full_name: '',
        email: '',
        phone: ''
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Registration failed'}`);
      } else {
        setMessage('❌ Registration failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestNFC = async () => {
    if (!newGuestRequest.reason) {
      setMessage('❌ Reason is required for NFC request');
      return;
    }

    setIsLoading(true);
    try {
      const requestUrl = `${API_URL}/guest/request-nfc`;
      console.log('Making NFC request to:', requestUrl);
      console.log('Auth headers:', getAuthHeaders());
      
      const res = await axios.post(
        requestUrl,
        newGuestRequest,
        getAuthHeaders()
      );
      setMessage(`✅ NFC card request submitted! Request ID: ${res.data.requestId}`);
      setNewGuestRequest({ reason: '', duration_hours: 24 });
      
      // Refresh requests
      fetchGuestRequests();
    } catch (err) {
      console.error('NFC request error:', err);
      if (axios.isAxiosError(err)) {
        console.error('Request config:', err.config);
        setMessage(`❌ ${err.response?.data?.error || 'Request failed'}`);
      } else {
        setMessage('❌ Request failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGuestRequests = async () => {
    try {
      const requestUrl = `${API_URL}/guest/my-requests`;
      console.log('Fetching guest requests from:', requestUrl);
      console.log('Auth headers:', getAuthHeaders());
      
      const res = await axios.get(requestUrl, getAuthHeaders());
      setNfcRequests(res.data);
    } catch (err) {
      console.error('Error fetching guest requests:', err);
      if (axios.isAxiosError(err)) {
        console.error('Request config:', err.config);
      }
    }
  };

  const fetchGuestAccounts = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/guests`, getAuthHeaders());
      setGuestAccounts(res.data);
    } catch (err) {
      console.error('Error fetching guest accounts:', err);
    }
  };

  const fetchAllNFCRequests = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/nfc-requests`, getAuthHeaders());
      setNfcRequests(res.data);
    } catch (err) {
      console.error('Error fetching NFC requests:', err);
    }
  };

  const handleRespondToRequest = async (requestId: number) => {
    setIsLoading(true);
    try {
      await axios.post(
        `${API_URL}/admin/nfc-request/${requestId}/respond`,
        responseData,
        getAuthHeaders()
      );
      setMessage(`✅ Request ${responseData.action}d successfully!`);
      setResponseData({
        action: 'approve',
        admin_notes: '',
        access_type: 'pin',
        nfc_card_id: '',
        approved_by: 'Admin'
      });
      
      // Refresh requests
      fetchAllNFCRequests();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Response failed'}`);
      } else {
        setMessage('❌ Response failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleScanNFC = async (requestId: number) => {
    setIsLoading(true);
    try {
      await axios.post(
        `${API_URL}/admin/scan-nfc`,
        { requestId },
        getAuthHeaders()
      );
      setMessage('🔍 NFC scanning activated! Please tap a card on the ESP32.');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Failed to activate NFC scanning'}`);
      } else {
        setMessage('❌ Failed to activate NFC scanning');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleGuestStatus = async (guestId: number) => {
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/admin/guests/${guestId}/toggle`, {}, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
      fetchGuestAccounts();
      fetchPendingUsers();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Toggle failed'}`);
      } else {
        setMessage('❌ Toggle failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPendingUsers = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/guests/pending`, getAuthHeaders());
      setPendingUsers(res.data);
    } catch (err) {
      console.error('Error fetching pending users:', err);
    }
  };

  const handleApproveRejectUser = async (guestId: number, action: 'approve' | 'reject', adminNotes?: string) => {
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/admin/guests/${guestId}/approve`, {
        action,
        adminNotes
      }, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
      fetchGuestAccounts();
      fetchPendingUsers();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Action failed'}`);
      } else {
        setMessage('❌ Action failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUser = async (guestId: number, username: string) => {
    if (!confirm(`Are you sure you want to permanently delete user "${username}"? This action cannot be undone.`)) {
      return;
    }

    setIsLoading(true);
    try {
      const res = await axios.delete(`${API_URL}/admin/guests/${guestId}`, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
      fetchGuestAccounts();
      fetchPendingUsers();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'Delete failed'}`);
      } else {
        setMessage('❌ Delete failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignPin = async (guestId: number, pinCode: string) => {
    if (!pinCode || pinCode.length < 4) {
      setMessage('❌ PIN code must be at least 4 digits');
      return;
    }

    setPinAssignment(prev => ({ ...prev, isAssigning: true }));
    try {
      const res = await axios.post(`${API_URL}/admin/guests/${guestId}/assign-pin`, {
        pin_code: pinCode
      }, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
      setPinAssignment({ guestId: 0, pinCode: '', isAssigning: false });
      fetchGuestAccounts();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'PIN assignment failed'}`);
      } else {
        setMessage('❌ PIN assignment failed');
      }
    } finally {
      setPinAssignment(prev => ({ ...prev, isAssigning: false }));
    }
  };

  const handleRemovePin = async (guestId: number, username: string) => {
    if (!confirm(`Are you sure you want to remove the PIN code for user "${username}"?`)) {
      return;
    }

    setIsLoading(true);
    try {
      const res = await axios.delete(`${API_URL}/admin/guests/${guestId}/pin`, getAuthHeaders());
      setMessage(`✅ ${res.data.message}`);
      fetchGuestAccounts();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setMessage(`❌ ${err.response?.data?.error || 'PIN removal failed'}`);
      } else {
        setMessage('❌ PIN removal failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const generateRandomPin = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  };

  const handleGuestLogout = () => {
    setGuestAuth(null);
    setGuestMode(false);
    setNfcRequests([]);
    localStorage.removeItem('guestAuthToken');
    setMessage('👋 Logged out successfully');
  };

  const clearMessage = () => {
    setTimeout(() => setMessage(''), 5000);
  };

  const confirmDeleteAction = (type: 'code' | 'card', value: string) => {
    setConfirmDelete({ type, value });
  };

  const executeDelete = async () => {
    if (!confirmDelete) return;
    
    if (confirmDelete.value === 'ALL_CODES') {
      await deleteAllCodes();
    } else if (confirmDelete.value === 'ALL_CARDS') {
      await deleteAllCards();
    } else if (confirmDelete.type === 'code') {
      await handleDeleteCode(confirmDelete.value);
    } else {
      await handleDisenroll(confirmDelete.value);
    }
    
    setConfirmDelete(null);
  };

  const cancelDelete = () => {
    setConfirmDelete(null);
  };

  const copyCodeToInput = (codeValue: string) => {
    setCode(codeValue);
    setMessage(`📋 Đã sao chép mã ${codeValue} vào ô nhập`);
  };

  const copyCardIdToInput = (cardId: string) => {
    setNfcId(cardId);
    setMessage(`📋 Đã sao chép ID thẻ ${cardId} vào ô nhập NFC`);
  };

  const deleteAllCodes = async () => {
    if (codes.length === 0) return;
    
    setIsLoading(true);
    try {
      const deletePromises = codes.map(c => 
        axios.post(`${API_URL}/delete-code`, { code: c.code }, getAuthHeaders())
      );
      await Promise.all(deletePromises);
      setMessage(`✅ Đã xóa tất cả ${codes.length} mã thành công`);
      fetchActive();
    } catch (err) {
      setMessage('❌ Có lỗi khi xóa một số mã');
      fetchActive(); // Refresh to see which codes remain
    } finally {
      setIsLoading(false);
    }
  };

  const deleteAllCards = async () => {
    if (cards.length === 0) return;
    
    setIsLoading(true);
    try {
      const deletePromises = cards.map(c => 
        axios.post(`${API_URL}/disenroll`, { id: c.id }, getAuthHeaders())
      );
      await Promise.all(deletePromises);
      setMessage(`✅ Đã hủy đăng ký tất cả ${cards.length} thẻ thành công`);
      fetchActive();
    } catch (err) {
      setMessage('❌ Có lỗi khi hủy đăng ký một số thẻ');
      fetchActive(); // Refresh to see which cards remain
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (message) clearMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  // Refetch logs when sorting/filtering changes
  useEffect(() => {
    fetchLogs(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logSortBy, logSortOrder, logFilterBy, logFilterValue, dateRangeStart, dateRangeEnd]);

  useEffect(() => {
    const socket = io('http://165.232.169.151:3000');
    fetchActive();
    fetchLogs(logPage);
    fetchESP32Users();
    fetchESP32Status();
    fetchGuestAccounts();
    fetchPendingUsers();
    fetchAllNFCRequests();
    
    // Check for existing guest session
    const savedToken = localStorage.getItem('guestAuthToken');
    if (savedToken && savedToken.startsWith('guest:')) {
      const [, username] = savedToken.split(':');
      if (username) {
        setGuestMode(true);
        fetchGuestRequests();
      }
    }
    
    socket.on('password-update', fetchActive);
    socket.on('nfc-update', fetchActive);
    socket.on('log-update', () => {
      console.log('Có thao tác mở khóa mới');
    });
    socket.on('new-log', (log) => {
      setLogs(prev => [log, ...prev.slice(0, 99)]);
    });

    // ESP32 Socket events
    socket.on('esp32-user-update', () => {
      fetchESP32Users();
      fetchESP32Status();
    });
    
    socket.on('esp32-response', (data) => {
      console.log('ESP32 Response:', data);
      if (data.payload && typeof data.payload === 'object') {
        setEsp32Status(prev => ({ ...prev, ...data.payload, is_online: 1 }));
      }
    });

    socket.on('nfc-detected', (data) => {
      setMessage(`🏷️ NFC Card detected: ${data.nfcId}`);
    });

    socket.on('pin-entered', (data) => {
      setMessage(`🔢 PIN entered on ESP32: ${data.pin}`);
    });

    // Guest system socket events
    socket.on('new-nfc-request', (data) => {
      setMessage(`🆕 New NFC request from ${data.guestName}`);
      fetchAllNFCRequests();
    });

    socket.on('nfc-request-responded', (data) => {
      setMessage(`📋 NFC request ${data.status} for ${data.guestName}`);
      fetchAllNFCRequests();
    });

    // User registration and approval events
    socket.on('new-user-registration', (data) => {
      setMessage(`👤 New user registration: ${data.username} (${data.full_name})`);
      fetchPendingUsers();
    });

    socket.on('user-approval-update', (data) => {
      setMessage(`📋 User ${data.username} has been ${data.action} by ${data.approved_by}`);
      fetchGuestAccounts();
      fetchPendingUsers();
    });

    socket.on('user-deleted', (data) => {
      setMessage(`🗑️ User ${data.username} has been deleted by ${data.deleted_by}`);
      fetchGuestAccounts();
      fetchPendingUsers();
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logPage]);

  const TabButton = ({ id, label, icon }: { id: string; label: string; icon: string }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium vietnamese-text transition-all duration-300 transform hover:scale-105 ${
        activeTab === id
          ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg scale-105'
          : 'bg-white/50 text-gray-700 hover:bg-white/80 hover:shadow-md'
      }`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );



  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* User Header */}
      <div className="bg-white shadow-md">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <span className="text-gray-600">Welcome, {user.username}</span>
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Admin</span>
            </div>
            <button
              onClick={logout}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
      
      <div className="container mx-auto px-4 py-8">

        {/* Enhanced Navigation Tabs */}
        <div className="flex justify-center mb-8">
          <div className="flex gap-2 bg-white/80 backdrop-blur-sm p-3 rounded-2xl shadow-xl">
            {guestMode ? (
              <>
                <TabButton id="guest-request" label="Yêu Cầu Thẻ NFC" icon="🏷️" />
                <TabButton id="guest-status" label="Yêu Cầu Của Tôi" icon="📋" />
                <button
                  onClick={handleGuestLogout}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium vietnamese-text transition-all duration-200 bg-gradient-to-r from-red-500 to-pink-600 text-white hover:shadow-lg transform hover:scale-105"
                >
                  <span>🚪</span>
                  Đăng Xuất
                </button>
              </>
            ) : (
              <>
                <TabButton id="unlock" label="Mở Khóa Cửa" icon="🔓" />
                <TabButton id="manage" label="Quản Lý Hệ Thống" icon="⚙️" />
                <TabButton id="logs" label="Nhật Ký Truy Cập" icon="�" />
                <TabButton id="esp32" label="ESP32 Ngoại Tuyến" icon="📡" />
                <TabButton id="guests" label="Quản Lý Người Dùng" icon="👥" />
                <TabButton id="guest-login" label="Đăng Nhập Khách" icon="🔐" />
              </>
            )}
          </div>
        </div>

        {/* Message Display */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg text-center font-medium ${
            message.includes('✅') ? 'bg-green-100 text-green-800 border border-green-200' :
            message.includes('❌') ? 'bg-red-100 text-red-800 border border-red-200' :
            message.includes('🔓') ? 'bg-blue-100 text-blue-800 border border-blue-200' :
            'bg-yellow-100 text-yellow-800 border border-yellow-200'
          }`}>
            {message}
          </div>
        )}

        {/* Enhanced Tab Content */}
        <div className="max-w-4xl mx-auto">
          {activeTab === 'unlock' && (
            <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
              <div className="text-center mb-8">
                <div className="animate-float mb-4">
                  <span className="text-5xl">🔓</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 vietnamese-text mb-2">Mở Khóa Cửa Thông Minh</h2>
                <p className="text-gray-600 vietnamese-text">Nhập mã PIN hoặc quét thẻ NFC để mở khóa</p>
              </div>
              
              <div className="space-y-6">
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-3 vietnamese-text">
                    💳 Nhập mã 6 chữ số hoặc ID thẻ NFC
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Ví dụ: 123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value.slice(0, 6))}
                      className="w-full px-6 py-4 border-2 border-gray-300 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 text-center text-xl font-mono bg-gradient-to-r from-blue-50 to-purple-50"
                      maxLength={6}
                    />
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                      <span className="text-2xl">🔢</span>
                    </div>
                  </div>
                  <div className="mt-3 p-3 bg-blue-50 rounded-xl border-l-4 border-blue-400">
                    <p className="text-sm text-blue-700 vietnamese-text flex items-center gap-2">
                      <span>💡</span>
                      <span>Mẹo: Sử dụng mã OTP hoặc mã tĩnh đã tạo, hoặc quét thẻ NFC</span>
                    </p>
                  </div>
                </div>

                <button 
                  onClick={handleUnlock} 
                  disabled={isLoading || !code}
                  className="w-full bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-8 py-4 rounded-2xl font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg hover:shadow-xl flex items-center justify-center gap-3 text-lg"
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full"></div>
                      Đang Xử Lý...
                    </>
                  ) : (
                    <>
                      <span className="text-2xl">🔓</span>
                      Mở Khóa Cửa
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="space-y-8">
              {/* Enhanced Code Management */}
              <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
                <div className="text-center mb-6">
                  <div className="animate-float mb-3">
                    <span className="text-4xl">🔢</span>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 vietnamese-text">Quản Lý Mã Truy Cập</h2>
                  <p className="text-gray-600 vietnamese-text mt-2">Tạo và quản lý mã PIN cho hệ thống</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>🔑</span>
                      Mã PIN 6 Chữ Số
                    </label>
                    <input
                      type="text"
                      placeholder="Ví dụ: 123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value.slice(0, 6))}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 text-center text-lg font-mono transition-all duration-300 bg-gradient-to-r from-blue-50 to-purple-50"
                      maxLength={6}
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>⏱️</span>
                      Thời Gian Hết Hạn (giây)
                    </label>
                    <input
                      type="number"
                      value={ttl}
                      onChange={(e) => setTtl(Number(e.target.value))}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 bg-gradient-to-r from-blue-50 to-purple-50"
                      min="60"
                      max="86400"
                    />
                  </div>
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-bold text-gray-700 mb-3 vietnamese-text flex items-center gap-2">
                    <span>🏷️</span>
                    Loại Mã Truy Cập
                  </label>
                  <select 
                    value={type} 
                    onChange={(e) => setType(e.target.value)} 
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 bg-gradient-to-r from-blue-50 to-purple-50 vietnamese-text"
                  >
                    <option value="otp">🔄 OTP (Mã Sử Dụng Một Lần)</option>
                    <option value="static">🔒 Static (Mã Tĩnh Vĩnh Viễn)</option>
                  </select>
                </div>

                <div className="flex gap-4 mb-6">
                  <button 
                    onClick={handleCreateCode} 
                    disabled={isLoading || !code || code.length !== 6}
                    className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-6 py-3 rounded-xl font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                        Đang Tạo...
                      </>
                    ) : (
                      <>
                        <span>➕</span>
                        Tạo Mã Mới
                      </>
                    )}
                  </button>
                  <button 
                    onClick={() => handleDeleteCode()} 
                    disabled={isLoading || !code}
                    className="flex-1 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-6 py-3 rounded-xl font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                        Đang Xóa...
                      </>
                    ) : (
                      <>
                        <span>🗑️</span>
                        Xóa Mã
                      </>
                    )}
                  </button>
                </div>

                <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border-l-4 border-blue-500">
                  <div className="space-y-2">
                    <p className="text-sm text-blue-800 vietnamese-text font-medium flex items-start gap-2">
                      <span className="text-lg">💡</span>
                      <span><strong>Hướng Dẫn Sử Dụng:</strong> Mã OTP sẽ tự động hết hạn sau thời gian đã đặt và chỉ sử dụng được một lần. Mã Static sẽ tồn tại vĩnh viễn cho đến khi bạn xóa thủ công.</span>
                    </p>
                    <p className="text-sm text-blue-800 vietnamese-text font-medium flex items-start gap-2">
                      <span className="text-lg">📋</span>
                      <span><strong>Mẹo Thông Minh:</strong> Trong danh sách mã bên dưới, nhấn nút sao chép (📋) để copy mã vào ô nhập, hoặc nhấn nút xóa (🗑️) để xóa trực tiếp.</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Enhanced NFC Management */}
              <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
                <div className="text-center mb-6">
                  <div className="animate-float mb-3">
                    <span className="text-4xl">💳</span>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 vietnamese-text">Quản Lý Thẻ NFC</h2>
                  <p className="text-gray-600 vietnamese-text mt-2">Đăng ký và quản lý thẻ NFC cho hệ thống</p>
                </div>
                
                <div className="mb-6">
                  <label className="block text-sm font-bold text-gray-700 mb-3 vietnamese-text flex items-center gap-2">
                    <span>🆔</span>
                    ID Thẻ NFC (Tùy Chọn)
                  </label>
                  <input
                    type="text"
                    placeholder="Để trống để kích hoạt ESP32 quét thẻ tự động"
                    value={nfcId}
                    onChange={(e) => setNfcId(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all duration-300 bg-gradient-to-r from-purple-50 to-pink-50 vietnamese-text"
                  />
                  <p className="text-sm text-gray-600 mt-2 vietnamese-text flex items-center gap-2">
                    <span>💡</span>
                    <span>Bỏ trống ID để ESP32 tự động đọc thẻ khi bạn nhấn "Đăng Ký Thẻ"</span>
                  </p>
                </div>

                <div className="flex gap-4 mb-6">
                  <button 
                    onClick={handleEnroll} 
                    disabled={isLoading}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-6 py-3 rounded-xl font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                        Đang Đăng Ký...
                      </>
                    ) : (
                      <>
                        <span>➕</span>
                        Đăng Ký Thẻ NFC
                      </>
                    )}
                  </button>
                  <button 
                    onClick={() => handleDisenroll()} 
                    disabled={isLoading || !nfcId}
                    className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-6 py-3 rounded-xl font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                        Đang Hủy...
                      </>
                    ) : (
                      <>
                        <span>🗑️</span>
                        Hủy Đăng Ký
                      </>
                    )}
                  </button>
                </div>

                <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border-l-4 border-purple-500">
                  <p className="text-sm text-purple-800 vietnamese-text font-medium flex items-start gap-2">
                    <span className="text-lg">🔮</span>
                    <span><strong>Hướng Dẫn NFC:</strong> Để đăng ký thẻ mới, bỏ trống ô ID và nhấn "Đăng Ký Thẻ NFC", sau đó đặt thẻ lên ESP32. Để hủy đăng ký, nhập ID thẻ cần xóa vào ô trên.</span>
                  </p>
                </div>

                <div className="mt-4 p-3 bg-purple-50 rounded-lg">
                  <p className="text-sm text-purple-700">
                    💡 <strong>Hướng dẫn:</strong> Để trống ID để ESP32 tự động đọc thẻ khi bạn nhấn "Đăng Ký Thẻ". Hoặc nhập ID thủ công nếu bạn biết.
                  </p>
                  <p className="text-sm text-purple-700 mt-2">
                    📋 <strong>Mẹo:</strong> Trong danh sách thẻ bên dưới, bạn có thể nhấn nút sao chép (📋) để copy ID vào ô nhập, hoặc nhấn nút xóa (🗑️) để hủy đăng ký trực tiếp.
                  </p>
                </div>
              </div>

              {/* Enhanced Active Items Display */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Enhanced Active Codes */}
                <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl animate-pulse">🔢</span>
                      <div>
                        <h3 className="text-xl font-bold text-gray-800 vietnamese-text">Mã Đang Hoạt Động</h3>
                        <p className="text-sm text-gray-600 vietnamese-text">Tổng cộng: {codes.length} mã</p>
                      </div>
                    </div>
                    {codes.length > 0 && (
                      <button
                        onClick={() => setConfirmDelete({ type: 'code', value: 'ALL_CODES' })}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-4 py-2 rounded-xl text-sm font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 shadow-lg flex items-center gap-2"
                        title="Xóa tất cả mã"
                      >
                        <span>🗑️</span>
                        Xóa Tất Cả
                      </button>
                    )}
                  </div>
                  {codes.length > 0 ? (
                    <div className="space-y-3">
                      {codes.map((c) => (
                        <div key={c.code} className="p-4 bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl border border-gray-200 hover:shadow-md transition-all duration-300">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex justify-between items-center mb-3">
                                <span className="font-mono text-xl font-bold text-gray-800 bg-white px-3 py-1 rounded-lg shadow-sm">{c.code}</span>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                                  c.type === 'otp' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white' : 'bg-gradient-to-r from-green-500 to-green-600 text-white'
                                }`}>
                                  {c.type === 'otp' ? '🔄 OTP' : '🔒 STATIC'}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 vietnamese-text flex items-center gap-2">
                                <span>⏰</span>
                                <span>Hết hạn: {new Date(c.expires_at).toLocaleString('vi-VN')}</span>
                              </p>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => copyCodeToInput(c.code)}
                                className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 transform hover:scale-110 shadow-lg"
                                title="Sao chép mã vào ô nhập"
                              >
                                📋
                              </button>
                              <button
                                onClick={() => confirmDeleteAction('code', c.code)}
                                disabled={isLoading}
                                className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 transform hover:scale-110 shadow-lg"
                                title="Xóa mã này"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="text-6xl mb-4 opacity-50">📭</div>
                      <p className="text-gray-500 vietnamese-text text-lg">Chưa có mã nào đang hoạt động</p>
                      <p className="text-gray-400 vietnamese-text text-sm mt-2">Tạo mã mới ở phía trên để bắt đầu</p>
                    </div>
                  )}
                </div>

                {/* Enhanced Active NFC Cards */}
                <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl animate-pulse">💳</span>
                      <div>
                        <h3 className="text-xl font-bold text-gray-800 vietnamese-text">Thẻ NFC Đã Đăng Ký</h3>
                        <p className="text-sm text-gray-600 vietnamese-text">Tổng cộng: {cards.length} thẻ</p>
                      </div>
                    </div>
                    {cards.length > 0 && (
                      <button
                        onClick={() => setConfirmDelete({ type: 'card', value: 'ALL_CARDS' })}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-4 py-2 rounded-xl text-sm font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 shadow-lg flex items-center gap-2"
                        title="Hủy đăng ký tất cả thẻ"
                      >
                        <span>🗑️</span>
                        Hủy Tất Cả
                      </button>
                    )}
                  </div>
                  {cards.length > 0 ? (
                    <div className="space-y-3">
                      {cards.map((c) => (
                        <div key={c.id} className="p-4 bg-gradient-to-r from-gray-50 to-purple-50 rounded-xl border border-gray-200 hover:shadow-md transition-all duration-300">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-mono text-lg font-bold text-gray-800 bg-white px-3 py-2 rounded-lg shadow-sm mb-3 break-all">{c.id}</div>
                              <p className="text-sm text-gray-600 vietnamese-text flex items-center gap-2">
                                <span>📅</span>
                                <span>Đăng ký: {new Date(c.enrolled_at).toLocaleString('vi-VN')}</span>
                              </p>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => copyCardIdToInput(c.id)}
                                className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 transform hover:scale-110 shadow-lg"
                                title="Sao chép ID thẻ vào ô nhập"
                              >
                                📋
                              </button>
                              <button
                                onClick={() => confirmDeleteAction('card', c.id)}
                                disabled={isLoading}
                                className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 transform hover:scale-110 shadow-lg"
                                title="Hủy đăng ký thẻ này"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="text-6xl mb-4 opacity-50">💳</div>
                      <p className="text-gray-500 vietnamese-text text-lg">Chưa có thẻ NFC nào được đăng ký</p>
                      <p className="text-gray-400 vietnamese-text text-sm mt-2">Đăng ký thẻ mới ở phía trên để bắt đầu</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
              <div className="text-center mb-8">
                <div className="animate-float mb-4">
                  <span className="text-5xl">📊</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 vietnamese-text mb-2">Nhật Ký Truy Cập Hệ Thống</h2>
                <p className="text-gray-600 vietnamese-text">Theo dõi tất cả hoạt động mở khóa và truy cập</p>
              </div>
              
              {/* Sorting and Filtering Controls */}
              <div className="mb-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-200">
                  {/* Sort Controls */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 vietnamese-text flex items-center gap-2">
                      <span>🔄</span>
                      Sắp Xếp Theo
                    </label>
                    <select
                      value={logSortBy}
                      onChange={(e) => handleLogSortChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 vietnamese-text bg-white"
                    >
                      <option value="time">⏰ Thời Gian (Chi Tiết)</option>
                      <option value="date">📅 Ngày</option>
                      <option value="user_name">👤 Tên Người Dùng</option>
                      <option value="method">🔧 Phương Thức</option>
                      <option value="success">🎯 Trạng Thái</option>
                    </select>
                  </div>
                  
                  {/* Sort Order */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 vietnamese-text flex items-center gap-2">
                      <span>↕️</span>
                      Thứ Tự
                    </label>
                    <button
                      onClick={() => setLogSortOrder(logSortOrder === 'asc' ? 'desc' : 'asc')}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 vietnamese-text flex items-center justify-center gap-2 transition-colors"
                    >
                      {logSortOrder === 'asc' ? '↑ Tăng Dần' : '↓ Giảm Dần'}
                    </button>
                  </div>
                  
                  {/* Filter Controls */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 vietnamese-text flex items-center gap-2">
                      <span>🔍</span>
                      Lọc Theo
                    </label>
                    <select
                      value={logFilterBy}
                      onChange={(e) => setLogFilterBy(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 vietnamese-text bg-white"
                    >
                      <option value="">-- Không Lọc --</option>
                      <option value="method">🔧 Phương Thức</option>
                      <option value="user_name">👤 Tên Người Dùng</option>
                      <option value="success">🎯 Trạng Thái</option>
                    </select>
                  </div>
                </div>
                
                {/* Filter Value Input */}
                {logFilterBy && (
                  <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 rounded-xl border border-green-200">
                    <div className="flex gap-4 items-end">
                      <div className="flex-1">
                        <label className="block text-sm font-bold text-gray-700 mb-2 vietnamese-text">
                          💬 Giá Trị Lọc
                        </label>
                        {logFilterBy === 'success' ? (
                          <select
                            value={logFilterValue}
                            onChange={(e) => setLogFilterValue(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 vietnamese-text bg-white"
                          >
                            <option value="">-- Chọn Trạng Thái --</option>
                            <option value="1">✅ Thành Công</option>
                            <option value="0">❌ Thất Bại</option>
                          </select>
                        ) : logFilterBy === 'method' ? (
                          <select
                            value={logFilterValue}
                            onChange={(e) => setLogFilterValue(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 vietnamese-text bg-white"
                          >
                            <option value="">-- Chọn Phương Thức --</option>
                            <option value="otp">🔢 OTP</option>
                            <option value="static">🔒 Static</option>
                            <option value="nfc">💳 NFC</option>
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={logFilterValue}
                            onChange={(e) => setLogFilterValue(e.target.value)}
                            placeholder="Nhập tên người dùng..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 vietnamese-text bg-white"
                          />
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleLogFilterChange(logFilterBy, logFilterValue)}
                          className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 vietnamese-text flex items-center gap-2 transition-all duration-300 transform hover:scale-105"
                        >
                          <span>🔍</span>
                          Áp Dụng
                        </button>
                        <button
                          onClick={clearLogFilter}
                          className="px-4 py-2 bg-gradient-to-r from-gray-500 to-gray-600 text-white rounded-lg hover:from-gray-600 hover:to-gray-700 vietnamese-text flex items-center gap-2 transition-all duration-300 transform hover:scale-105"
                        >
                          <span>🗑️</span>
                          Xóa Lọc
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Date Range Filter */}
                <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl border border-orange-200">
                  <div className="mb-3">
                    <label className="block text-sm font-bold text-gray-700 mb-2 vietnamese-text flex items-center gap-2">
                      <span>📅</span>
                      Lọc Theo Khoảng Thời Gian
                    </label>
                    <p className="text-xs text-gray-600 vietnamese-text">Chọn khoảng thời gian để lọc nhật ký</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2 vietnamese-text">
                        🕐 Từ ngày/giờ
                      </label>
                      <input
                        type="datetime-local"
                        value={dateRangeStart}
                        onChange={(e) => setDateRangeStart(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 vietnamese-text bg-white"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2 vietnamese-text">
                        🕕 Đến ngày/giờ
                      </label>
                      <input
                        type="datetime-local"
                        value={dateRangeEnd}
                        onChange={(e) => setDateRangeEnd(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 vietnamese-text bg-white"
                      />
                    </div>
                  </div>
                  
                  <div className="mt-4 flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        const today = new Date();
                        const yesterday = new Date(today);
                        yesterday.setDate(yesterday.getDate() - 1);
                        setDateRangeStart(yesterday.toISOString().slice(0, 16));
                        setDateRangeEnd(today.toISOString().slice(0, 16));
                      }}
                      className="px-3 py-1 bg-blue-100 text-blue-800 rounded-lg text-sm hover:bg-blue-200 transition-colors vietnamese-text"
                    >
                      📅 24h Qua
                    </button>
                    <button
                      onClick={() => {
                        const today = new Date();
                        const weekAgo = new Date(today);
                        weekAgo.setDate(weekAgo.getDate() - 7);
                        setDateRangeStart(weekAgo.toISOString().slice(0, 16));
                        setDateRangeEnd(today.toISOString().slice(0, 16));
                      }}
                      className="px-3 py-1 bg-green-100 text-green-800 rounded-lg text-sm hover:bg-green-200 transition-colors vietnamese-text"
                    >
                      📅 7 Ngày Qua
                    </button>
                    <button
                      onClick={() => {
                        setDateRangeStart('');
                        setDateRangeEnd('');
                      }}
                      className="px-3 py-1 bg-gray-100 text-gray-800 rounded-lg text-sm hover:bg-gray-200 transition-colors vietnamese-text"
                    >
                      🗑️ Xóa
                    </button>
                  </div>
                </div>
                
                {/* Results Info */}
                <div className="text-center text-sm text-gray-600 vietnamese-text">
                  {totalLogs > 0 && (
                    <div className="space-y-2">
                      <p>
                        📊 Hiển thị {logs.length} / {totalLogs} bản ghi
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {logFilterBy && logFilterValue && (
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-lg text-xs">
                            🔍 Lọc: {logFilterBy} = "{logFilterValue}"
                          </span>
                        )}
                        {dateRangeStart && (
                          <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded-lg text-xs">
                            📅 Từ: {new Date(dateRangeStart).toLocaleString('vi-VN', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        )}
                        {dateRangeEnd && (
                          <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded-lg text-xs">
                            📅 Đến: {new Date(dateRangeEnd).toLocaleString('vi-VN', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {logs.length > 0 ? (
                <>
                  <div className="overflow-x-auto rounded-2xl border border-gray-200">
                    <table className="w-full bg-white">
                      <thead className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
                        <tr>
                          <th 
                            className="text-left py-4 px-6 font-bold vietnamese-text cursor-pointer hover:bg-white/20 transition-colors select-none"
                            onClick={() => handleLogSortChange('user_name')}
                            title="Nhấn để sắp xếp theo tên người dùng"
                          >
                            <div className="flex items-center gap-2">
                              <span>👤 Người Dùng</span>
                              {logSortBy === 'user_name' && (
                                <span className="text-yellow-300">
                                  {logSortOrder === 'asc' ? '↑' : '↓'}
                                </span>
                              )}
                            </div>
                          </th>
                          <th className="text-left py-4 px-6 font-bold vietnamese-text">🔑 Mã / ID Thẻ</th>
                          <th 
                            className="text-left py-4 px-6 font-bold vietnamese-text cursor-pointer hover:bg-white/20 transition-colors select-none"
                            onClick={() => handleLogSortChange('method')}
                            title="Nhấn để sắp xếp theo phương thức"
                          >
                            <div className="flex items-center gap-2">
                              <span>🔧 Phương Thức</span>
                              {logSortBy === 'method' && (
                                <span className="text-yellow-300">
                                  {logSortOrder === 'asc' ? '↑' : '↓'}
                                </span>
                              )}
                            </div>
                          </th>
                          <th 
                            className="text-left py-4 px-6 font-bold vietnamese-text cursor-pointer hover:bg-white/20 transition-colors select-none"
                            onClick={() => handleLogSortChange('time')}
                            title="Nhấn để sắp xếp theo thời gian chi tiết"
                          >
                            <div className="flex items-center gap-2">
                              <span>⏰ Thời Gian</span>
                              {(logSortBy === 'time' || logSortBy === 'date') && (
                                <span className="text-yellow-300">
                                  {logSortOrder === 'asc' ? '↑' : '↓'}
                                </span>
                              )}
                              {logSortBy === 'date' && (
                                <span className="text-yellow-200 text-xs">📅</span>
                              )}
                            </div>
                          </th>
                          <th 
                            className="text-left py-4 px-6 font-bold vietnamese-text cursor-pointer hover:bg-white/20 transition-colors select-none"
                            onClick={() => handleLogSortChange('success')}
                            title="Nhấn để sắp xếp theo trạng thái"
                          >
                            <div className="flex items-center gap-2">
                              <span>🎯 Trạng Thái</span>
                              {logSortBy === 'success' && (
                                <span className="text-yellow-300">
                                  {logSortOrder === 'asc' ? '↑' : '↓'}
                                </span>
                              )}
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {logs.map((l, i) => (
                          <tr key={i} className="hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 transition-all duration-300">
                            <td className="py-4 px-6 text-sm">
                              <div className="flex flex-col">
                                <span className="font-bold text-gray-900 vietnamese-text">
                                  {l.user_name || (l.method === 'esp32_pin' ? 'Người Dùng ESP32' : 
                                                   l.method === 'esp32_nfc' ? 'Người Dùng ESP32' :
                                                   l.method === 'password' ? 'Quản Trị Viên' :
                                                   l.method === 'nfc' ? 'Quản Trị Viên' :
                                                   'Người Dùng Ẩn Danh')}
                                </span>
                                {l.user_id && (
                                  <span className="text-xs text-gray-500 vietnamese-text">ID: {l.user_id}</span>
                                )}
                              </div>
                            </td>
                            <td className="py-4 px-6 font-mono text-sm bg-gray-50 rounded-lg font-bold">{l.code}</td>
                            <td className="py-4 px-6 text-sm">
                              <span className={`px-3 py-2 rounded-full text-xs font-bold uppercase tracking-wide ${
                                l.method === 'esp32_pin' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white' :
                                l.method === 'esp32_nfc' ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white' :
                                l.method === 'password' ? 'bg-gradient-to-r from-green-500 to-green-600 text-white' :
                                l.method === 'nfc' ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white' :
                                'bg-gradient-to-r from-gray-500 to-gray-600 text-white'
                              }`}>
                                {l.method === 'esp32_pin' ? '📱 ESP32 PIN' :
                                 l.method === 'esp32_nfc' ? '📱 ESP32 NFC' :
                                 l.method === 'password' ? '🔢 Mật Khẩu Web' :
                                 l.method === 'nfc' ? '📟 NFC Web' :
                                 l.method}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-sm text-gray-700 vietnamese-text font-medium">
                              {new Date(l.time).toLocaleString('vi-VN')}
                            </td>
                            <td className="py-4 px-6">
                              <span className={`px-3 py-2 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-2 w-fit ${
                                l.success 
                                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white' 
                                  : 'bg-gradient-to-r from-red-500 to-red-600 text-white'
                              }`}>
                                <span>{l.success ? '✅' : '❌'}</span>
                                <span className="vietnamese-text">{l.success ? 'Thành Công' : 'Thất Bại'}</span>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-200">
                    <button
                      disabled={logPage === 1}
                      onClick={() => {
                        const newPage = Math.max(logPage - 1, 1);
                        setLogPage(newPage);
                        fetchLogs(newPage, true);
                      }}
                      className="px-6 py-3 bg-gradient-to-r from-gray-400 to-gray-500 hover:from-gray-500 hover:to-gray-600 disabled:from-gray-200 disabled:to-gray-300 text-white rounded-xl font-bold vietnamese-text disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg flex items-center gap-2"
                    >
                      <span>←</span>
                      Trang Trước
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-gray-700 vietnamese-text">
                        Trang {logPage}
                        {totalLogs > 0 && (
                          <span className="text-sm text-gray-500 ml-2">
                            ({Math.min(logPage * LOG_LIMIT, totalLogs)} / {totalLogs})
                          </span>
                        )}
                      </span>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    </div>
                    <button
                      disabled={logs.length < LOG_LIMIT}
                      onClick={() => {
                        const newPage = logPage + 1;
                        setLogPage(newPage);
                        fetchLogs(newPage, true);
                      }}
                      className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-200 disabled:to-gray-300 text-white rounded-xl font-bold vietnamese-text disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg flex items-center gap-2"
                    >
                      Trang Sau
                      <span>→</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="text-8xl mb-6 opacity-50">📊</div>
                  <p className="text-gray-500 vietnamese-text text-xl mb-2">Chưa có dữ liệu nhật ký</p>
                  <p className="text-gray-400 vietnamese-text text-sm">Thực hiện một số hoạt động mở khóa để xem nhật ký ở đây</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'esp32' && (
            <div className="space-y-6">
              {/* ESP32 Status */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-6">📡 ESP32 System Status</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <div className="text-blue-600 font-semibold">Status</div>
                    <div className={`font-bold ${esp32Status.is_online ? 'text-green-600' : 'text-red-600'}`}>
                      {esp32Status.is_online ? '🟢 Online' : '🔴 Offline'}
                    </div>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="text-green-600 font-semibold">Users</div>
                    <div className="text-2xl font-bold text-green-800">{esp32Status.user_count}</div>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                    <div className="text-red-600 font-semibold">Failed Attempts</div>
                    <div className="text-2xl font-bold text-red-800">{esp32Status.failed_attempts}</div>
                  </div>
                  <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                    <div className="text-yellow-600 font-semibold">Lockout</div>
                    <div className="text-2xl font-bold text-yellow-800">
                      {esp32Status.lockout_time > 0 ? `${Math.ceil(esp32Status.lockout_time / 1000)}s` : 'None'}
                    </div>
                  </div>
                </div>
                {esp32Status.last_sync > 0 && (
                  <div className="mt-4 text-sm text-gray-500">
                    Last sync: {new Date(esp32Status.last_sync).toLocaleString('vi-VN')}
                  </div>
                )}
              </div>

              {/* Add User Form */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">➕ Add New User to ESP32</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter user name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">PIN</label>
                    <input
                      type="password"
                      value={newUser.pin}
                      onChange={(e) => setNewUser(prev => ({ ...prev, pin: e.target.value }))}
                      placeholder="Enter 4-8 digit PIN"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">NFC ID (Optional)</label>
                    <input
                      type="text"
                      value={newUser.nfc_id}
                      onChange={(e) => setNewUser(prev => ({ ...prev, nfc_id: e.target.value }))}
                      placeholder="Leave empty to enroll later"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Authentication Type</label>
                    <select
                      value={newUser.auth_type}
                      onChange={(e) => setNewUser(prev => ({ ...prev, auth_type: Number(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={1}>🔢 PIN Only</option>
                      <option value={2}>🏷️ NFC Only</option>
                      <option value={3}>🔒 PIN + NFC (Combined)</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleAddESP32User}
                  disabled={isLoading || !newUser.name || !newUser.pin}
                  className="mt-4 w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 transition-all duration-200"
                >
                  {isLoading ? '⏳ Adding...' : '➕ Add User to ESP32'}
                </button>
              </div>

              {/* Users List */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-800">👥 ESP32 Users</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={fetchESP32Users}
                      className="px-3 py-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-all duration-200"
                    >
                      🔄 Refresh
                    </button>
                    <button
                      onClick={handleResetESP32}
                      className="px-3 py-1 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-all duration-200"
                    >
                      🗑️ Factory Reset
                    </button>
                  </div>
                </div>

                {esp32Users.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Name</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Auth Type</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Synced</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {esp32Users.map((user) => (
                          <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-3 px-4 font-medium">{user.name}</td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                user.auth_type === 1 ? 'bg-blue-100 text-blue-800' :
                                user.auth_type === 2 ? 'bg-green-100 text-green-800' :
                                'bg-purple-100 text-purple-800'
                              }`}>
                                {user.auth_type === 1 ? '🔢 PIN' : 
                                 user.auth_type === 2 ? '🏷️ NFC' : 
                                 '🔒 PIN+NFC'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {user.is_active ? '✅ Active' : '❌ Inactive'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                user.synced_to_esp32 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                              }`}>
                                {user.synced_to_esp32 ? '✅ Synced' : '⏳ Pending'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  onClick={() => handleAssignPIN(user.id, user.name)}
                                  className="px-2 py-1 bg-green-100 text-green-600 rounded text-xs hover:bg-green-200 transition-all duration-200"
                                >
                                  🔢 Assign PIN
                                </button>
                                {(!user.nfc_id || user.nfc_id === '') && (
                                  <button
                                    onClick={() => handleEnrollNFC(user.id)}
                                    className="px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs hover:bg-blue-200 transition-all duration-200"
                                  >
                                    🏷️ Enroll NFC
                                  </button>
                                )}
                                <button
                                  onClick={() => handleRemoveESP32User(user.id)}
                                  className="px-2 py-1 bg-red-100 text-red-600 rounded text-xs hover:bg-red-200 transition-all duration-200"
                                >
                                  🗑️ Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No users found on ESP32</p>
                    <p className="text-sm text-gray-400 mt-2">Add your first user above to get started</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Enhanced Guest Login Tab */}
          {activeTab === 'guest-login' && (
            <div className="space-y-8">
              {/* Enhanced Login Form */}
              <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
                <div className="text-center mb-8">
                  <div className="animate-float mb-4">
                    <span className="text-5xl">🔐</span>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 vietnamese-text mb-2">Đăng Nhập Khách</h2>
                  <p className="text-gray-600 vietnamese-text">Đăng nhập với tài khoản khách đã được cấp</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>👤</span>
                      Tên Đăng Nhập
                    </label>
                    <input
                      type="text"
                      value={guestLogin.username}
                      onChange={(e) => setGuestLogin(prev => ({ ...prev, username: e.target.value }))}
                      placeholder="Nhập tên đăng nhập"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 bg-gradient-to-r from-blue-50 to-purple-50 vietnamese-text"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>🔒</span>
                      Mật Khẩu
                    </label>
                    <input
                      type="password"
                      value={guestLogin.password}
                      onChange={(e) => setGuestLogin(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="Nhập mật khẩu"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 bg-gradient-to-r from-blue-50 to-purple-50 vietnamese-text"
                    />
                  </div>
                </div>
                <button
                  onClick={handleGuestLogin}
                  disabled={isLoading || !guestLogin.username || !guestLogin.password}
                  className="mt-6 w-full px-6 py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-2xl font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg hover:shadow-xl flex items-center justify-center gap-3 text-lg"
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full"></div>
                      Đang Đăng Nhập...
                    </>
                  ) : (
                    <>
                      <span className="text-2xl">🔐</span>
                      Đăng Nhập Khách
                    </>
                  )}
                </button>
              </div>

              {/* Enhanced Register Form */}
              <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
                <div className="text-center mb-8">
                  <div className="animate-float mb-4">
                    <span className="text-5xl">📝</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 vietnamese-text mb-2">Đăng Ký Tài Khoản Khách Mới</h3>
                  <p className="text-gray-600 vietnamese-text">Tạo tài khoản khách để yêu cầu quyền truy cập</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>👤</span>
                      Tên Đăng Nhập <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={guestRegister.username}
                      onChange={(e) => setGuestRegister(prev => ({ ...prev, username: e.target.value }))}
                      placeholder="Chọn tên đăng nhập"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-green-500/20 focus:border-green-500 transition-all duration-300 bg-gradient-to-r from-green-50 to-blue-50 vietnamese-text"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>🔒</span>
                      Mật Khẩu <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={guestRegister.password}
                      onChange={(e) => setGuestRegister(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="Chọn mật khẩu"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-green-500/20 focus:border-green-500 transition-all duration-300 bg-gradient-to-r from-green-50 to-blue-50 vietnamese-text"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>📛</span>
                      Họ Tên Đầy Đủ <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={guestRegister.full_name}
                      onChange={(e) => setGuestRegister(prev => ({ ...prev, full_name: e.target.value }))}
                      placeholder="Họ và tên của bạn"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-green-500/20 focus:border-green-500 transition-all duration-300 bg-gradient-to-r from-green-50 to-blue-50 vietnamese-text"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>📧</span>
                      Email (Tùy Chọn)
                    </label>
                    <input
                      type="email"
                      value={guestRegister.email}
                      onChange={(e) => setGuestRegister(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="email@example.com"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-green-500/20 focus:border-green-500 transition-all duration-300 bg-gradient-to-r from-green-50 to-blue-50 vietnamese-text"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-3">
                    <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                      <span>📱</span>
                      Số Điện Thoại (Tùy Chọn)
                    </label>
                    <input
                      type="tel"
                      value={guestRegister.phone}
                      onChange={(e) => setGuestRegister(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="+84 xxx xxx xxx"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-green-500/20 focus:border-green-500 transition-all duration-300 bg-gradient-to-r from-green-50 to-blue-50 vietnamese-text"
                    />
                  </div>
                </div>
                <button
                  onClick={handleGuestRegister}
                  disabled={isLoading || !guestRegister.username || !guestRegister.password || !guestRegister.full_name}
                  className="mt-6 w-full px-6 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-2xl font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg hover:shadow-xl flex items-center justify-center gap-3 text-lg"
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full"></div>
                      Đang Tạo Tài Khoản...
                    </>
                  ) : (
                    <>
                      <span className="text-2xl">📝</span>
                      Tạo Tài Khoản Khách
                    </>
                  )}
                </button>
                <div className="mt-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border-l-4 border-amber-500">
                  <p className="text-sm text-amber-800 vietnamese-text font-medium flex items-start gap-2">
                    <span className="text-lg">⚠️</span>
                    <span><strong>Lưu Ý:</strong> Tài khoản khách cần được quản trị viên phê duyệt trước khi có thể đăng nhập và yêu cầu quyền truy cập.</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Enhanced Guest Request NFC Tab */}
          {activeTab === 'guest-request' && guestMode && (
            <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
              <div className="text-center mb-8">
                <div className="animate-float mb-4">
                  <span className="text-5xl">🏷️</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 vietnamese-text mb-2">Yêu Cầu Thẻ Truy Cập NFC</h2>
                <p className="text-gray-600 vietnamese-text">Gửi yêu cầu để được cấp thẻ NFC hoặc mã PIN truy cập</p>
              </div>
              
              {guestAuth && (
                <div className="mb-8 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 shadow-lg">
                  <div className="flex items-center gap-4">
                    <div className="text-4xl">👋</div>
                    <div>
                      <h3 className="font-bold text-blue-800 vietnamese-text text-lg">Chào mừng, {guestAuth.full_name}!</h3>
                      <p className="text-blue-600 text-sm vietnamese-text">Tên đăng nhập: {guestAuth.username}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                    <span>📝</span>
                    Lý Do Yêu Cầu Truy Cập <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={newGuestRequest.reason}
                    onChange={(e) => setNewGuestRequest(prev => ({ ...prev, reason: e.target.value }))}
                    placeholder="Vui lòng mô tả lý do bạn cần quyền truy cập thẻ NFC..."
                    rows={4}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 bg-gradient-to-r from-blue-50 to-purple-50 vietnamese-text resize-none"
                  />
                </div>
                
                <div className="space-y-3">
                  <label className="block text-sm font-bold text-gray-700 vietnamese-text flex items-center gap-2">
                    <span>⏱️</span>
                    Thời Gian Sử Dụng
                  </label>
                  <select
                    value={newGuestRequest.duration_hours}
                    onChange={(e) => setNewGuestRequest(prev => ({ ...prev, duration_hours: Number(e.target.value) }))}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 bg-gradient-to-r from-blue-50 to-purple-50 vietnamese-text"
                  >
                    <option value={1}>1 giờ</option>
                    <option value={4}>4 giờ</option>
                    <option value={8}>8 giờ</option>
                    <option value={24}>24 giờ (1 ngày)</option>
                    <option value={72}>72 giờ (3 ngày)</option>
                    <option value={168}>168 giờ (1 tuần)</option>
                  </select>
                </div>

                <button
                  onClick={handleRequestNFC}
                  disabled={isLoading || !newGuestRequest.reason}
                  className="w-full px-6 py-4 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-2xl font-bold vietnamese-text transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg hover:shadow-xl flex items-center justify-center gap-3 text-lg"
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full"></div>
                      Đang Gửi Yêu Cầu...
                    </>
                  ) : (
                    <>
                      <span className="text-2xl">🏷️</span>
                      Gửi Yêu Cầu Thẻ NFC
                    </>
                  )}
                </button>
                
                <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border-l-4 border-purple-500">
                  <p className="text-sm text-purple-800 vietnamese-text font-medium flex items-start gap-2">
                    <span className="text-lg">💡</span>
                    <span><strong>Hướng Dẫn:</strong> Sau khi gửi yêu cầu, quản trị viên sẽ xem xét và có thể cấp cho bạn thẻ NFC hoặc mã PIN để truy cập. Bạn sẽ nhận được thông báo kết quả.</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Enhanced Guest Status Tab */}
          {activeTab === 'guest-status' && guestMode && (
            <div className="card-hover bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
              <div className="text-center mb-8">
                <div className="animate-float mb-4">
                  <span className="text-5xl">📋</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 vietnamese-text mb-2">Yêu Cầu NFC Của Tôi</h2>
                <p className="text-gray-600 vietnamese-text">Theo dõi trạng thái các yêu cầu thẻ NFC đã gửi</p>
              </div>
              
              {nfcRequests.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-gray-200">
                  <table className="w-full bg-white">
                    <thead className="bg-gradient-to-r from-purple-500 to-pink-600 text-white">
                      <tr>
                        <th className="text-left py-4 px-6 font-bold vietnamese-text">📝 Lý Do</th>
                        <th className="text-left py-4 px-6 font-bold vietnamese-text">🎯 Trạng Thái</th>
                        <th className="text-left py-4 px-6 font-bold vietnamese-text">📅 Ngày Gửi</th>
                        <th className="text-left py-4 px-6 font-bold vietnamese-text">⏰ Hết Hạn</th>
                        <th className="text-left py-4 px-6 font-bold vietnamese-text">💬 Ghi Chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {nfcRequests.map((request) => (
                        <tr key={request.id} className="hover:bg-gradient-to-r hover:from-purple-50 hover:to-pink-50 transition-all duration-300">
                          <td className="py-4 px-6 vietnamese-text font-medium">{request.reason}</td>
                          <td className="py-4 px-6">
                            <span className={`px-3 py-2 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-2 w-fit ${
                              request.status === 'approved' ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white' :
                              request.status === 'pending' ? 'bg-gradient-to-r from-yellow-500 to-orange-600 text-white' :
                              request.status === 'rejected' ? 'bg-gradient-to-r from-red-500 to-red-600 text-white' :
                              'bg-gradient-to-r from-gray-500 to-gray-600 text-white'
                            }`}>
                              {request.status === 'approved' ? (
                                <>
                                  <span>✅</span>
                                  <span>Đã Duyệt</span>
                                </>
                              ) : request.status === 'pending' ? (
                                <>
                                  <span>⏳</span>
                                  <span>Chờ Duyệt</span>
                                </>
                              ) : request.status === 'rejected' ? (
                                <>
                                  <span>❌</span>
                                  <span>Từ Chối</span>
                                </>
                              ) : (
                                <>
                                  <span>❓</span>
                                  <span>{request.status}</span>
                                </>
                              )}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-sm text-gray-700 vietnamese-text font-medium">
                            {new Date(request.requested_at).toLocaleString('vi-VN')}
                          </td>
                          <td className="py-4 px-6 text-sm text-gray-700 vietnamese-text font-medium">
                            {new Date(request.expires_at).toLocaleString('vi-VN')}
                          </td>
                          <td className="py-4 px-6 text-sm text-gray-700 vietnamese-text">
                            {request.admin_notes || 'Không có ghi chú'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4 opacity-50">📋</div>
                  <p className="text-gray-500 vietnamese-text text-lg mb-2">Chưa có yêu cầu nào</p>
                  <p className="text-gray-400 vietnamese-text text-sm">Nhấn "Yêu Cầu Thẻ NFC" để gửi yêu cầu đầu tiên của bạn</p>
                </div>
              )}
            </div>
          )}

          {/* Admin User Management Tab */}
          {activeTab === 'guests' && !guestMode && (
            <div className="space-y-6">
              {/* Pending User Approvals */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-semibold text-gray-800">⏳ Pending User Registrations ({pendingUsers.length})</h2>
                  <button
                    onClick={fetchPendingUsers}
                    className="px-3 py-1 bg-orange-100 text-orange-600 rounded-lg hover:bg-orange-200 transition-all duration-200"
                  >
                    🔄 Refresh
                  </button>
                </div>

                {pendingUsers.length > 0 ? (
                  <div className="space-y-4">
                    {pendingUsers.map((user) => (
                      <div key={user.id} className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-gray-800">{user.full_name}</h3>
                              <span className="text-sm text-gray-600">@{user.username}</span>
                              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
                                PENDING
                              </span>
                            </div>
                            <div className="text-sm text-gray-600 space-y-1">
                              <p>📧 {user.email || 'No email provided'}</p>
                              <p>📱 {user.phone || 'No phone provided'}</p>
                              <p>📅 Registered: {new Date(user.created_at).toLocaleString()}</p>
                            </div>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <button
                              onClick={() => handleApproveRejectUser(user.id, 'approve')}
                              disabled={isLoading}
                              className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300 transition-all duration-200"
                            >
                              ✅ Approve
                            </button>
                            <button
                              onClick={() => handleApproveRejectUser(user.id, 'reject')}
                              disabled={isLoading}
                              className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300 transition-all duration-200"
                            >
                              ❌ Reject
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No pending registrations</p>
                    <p className="text-sm text-gray-400 mt-2">All new user registrations will appear here for approval</p>
                  </div>
                )}
              </div>

              {/* All User Accounts */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-semibold text-gray-800">👥 All User Accounts ({guestAccounts.length})</h2>
                  <button
                    onClick={fetchGuestAccounts}
                    className="px-3 py-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-all duration-200"
                  >
                    🔄 Refresh
                  </button>
                </div>

                {guestAccounts.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Username</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Full Name</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Email</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Created</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">PIN Code</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Approval</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {guestAccounts.map((guest) => (
                          <tr key={guest.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-3 px-4 font-medium">{guest.username}</td>
                            <td className="py-3 px-4">{guest.full_name}</td>
                            <td className="py-3 px-4">{guest.email || '-'}</td>
                            <td className="py-3 px-4 text-sm text-gray-600">
                              {new Date(guest.created_at).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4">
                              {guest.pin_code ? (
                                <div className="flex items-center gap-2">
                                  <code className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-mono">
                                    {guest.pin_code}
                                  </code>
                                  <button
                                    onClick={() => handleRemovePin(guest.id, guest.username)}
                                    disabled={isLoading}
                                    className="text-red-500 hover:text-red-700 text-xs"
                                    title="Remove PIN"
                                  >
                                    ❌
                                  </button>
                                </div>
                              ) : pinAssignment.guestId === guest.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={pinAssignment.pinCode}
                                    onChange={(e) => setPinAssignment(prev => ({ ...prev, pinCode: e.target.value }))}
                                    placeholder="Enter PIN"
                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-xs"
                                    maxLength={6}
                                  />
                                  <button
                                    onClick={() => handleAssignPin(guest.id, pinAssignment.pinCode)}
                                    disabled={pinAssignment.isAssigning}
                                    className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 disabled:bg-gray-300"
                                  >
                                    ✅
                                  </button>
                                  <button
                                    onClick={() => setPinAssignment({ guestId: 0, pinCode: '', isAssigning: false })}
                                    className="text-gray-500 hover:text-gray-700 text-xs"
                                  >
                                    ❌
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <span className="text-gray-400 text-xs">No PIN</span>
                                  <button
                                    onClick={() => setPinAssignment({ guestId: guest.id, pinCode: generateRandomPin(), isAssigning: false })}
                                    disabled={isLoading}
                                    className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200"
                                    title="Assign PIN"
                                  >
                                    🔧
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                guest.approval_status === 'approved' ? 'bg-green-100 text-green-800' :
                                guest.approval_status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {guest.approval_status?.toUpperCase()}
                              </span>
                              {guest.approved_by && (
                                <div className="text-xs text-gray-500 mt-1">
                                  by {guest.approved_by}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                guest.is_active ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                              }`}>
                                {guest.is_active ? '🟢 Active' : '🔴 Disabled'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex gap-1">
                                {guest.approval_status === 'pending' && (
                                  <>
                                    <button
                                      onClick={() => handleApproveRejectUser(guest.id, 'approve')}
                                      disabled={isLoading}
                                      className="px-2 py-1 bg-green-100 text-green-600 rounded text-xs hover:bg-green-200 disabled:bg-gray-300 transition-all duration-200"
                                    >
                                      ✅
                                    </button>
                                    <button
                                      onClick={() => handleApproveRejectUser(guest.id, 'reject')}
                                      disabled={isLoading}
                                      className="px-2 py-1 bg-red-100 text-red-600 rounded text-xs hover:bg-red-200 disabled:bg-gray-300 transition-all duration-200"
                                    >
                                      ❌
                                    </button>
                                  </>
                                )}
                                {guest.approval_status === 'approved' && (
                                  <button
                                    onClick={() => handleToggleGuestStatus(guest.id)}
                                    disabled={isLoading}
                                    className={`px-2 py-1 rounded text-xs transition-all duration-200 ${
                                      guest.is_active 
                                        ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200' 
                                        : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                                    } disabled:bg-gray-300`}
                                  >
                                    {guest.is_active ? '🚫' : '✅'}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteUser(guest.id, guest.username)}
                                  disabled={isLoading}
                                  className="px-2 py-1 bg-red-100 text-red-600 rounded text-xs hover:bg-red-200 disabled:bg-gray-300 transition-all duration-200"
                                  title="Delete user permanently"
                                >
                                  🗑️
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No user accounts found</p>
                  </div>
                )}
              </div>

              {/* Access Requests Management */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-800">🔐 Access Requests</h3>
                  <button
                    onClick={fetchAllNFCRequests}
                    className="px-3 py-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-all duration-200"
                  >
                    🔄 Refresh
                  </button>
                </div>

                {nfcRequests.length > 0 ? (
                  <div className="space-y-4">
                    {nfcRequests.map((request) => (
                      <div key={request.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-800">{request.guest_name}</h4>
                            <p className="text-sm text-gray-600">@{request.username} • {request.email}</p>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            request.status === 'approved' ? 'bg-green-100 text-green-800' :
                            request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            request.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {request.status.toUpperCase()}
                          </span>
                        </div>
                        
                        <div className="mb-3">
                          <p className="text-gray-700"><strong>Reason:</strong> {request.reason}</p>
                          <p className="text-sm text-gray-500">
                            Requested: {new Date(request.requested_at).toLocaleString()} • 
                            Expires: {new Date(request.expires_at).toLocaleString()}
                          </p>
                        </div>

                        {request.status === 'pending' && (
                          <div className="space-y-3">
                            {/* Access Type Selection */}
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Access Type</label>
                              <div className="flex gap-4">
                                <label className="flex items-center">
                                  <input
                                    type="radio"
                                    name={`access-type-${request.id}`}
                                    value="pin"
                                    checked={responseData.access_type === 'pin'}
                                    onChange={(e) => setResponseData(prev => ({ ...prev, access_type: e.target.value as 'pin' | 'nfc' }))}
                                    className="mr-2"
                                  />
                                  <span className="text-sm">🔢 Generate 6-digit PIN</span>
                                </label>
                                <label className="flex items-center">
                                  <input
                                    type="radio"
                                    name={`access-type-${request.id}`}
                                    value="nfc"
                                    checked={responseData.access_type === 'nfc'}
                                    onChange={(e) => setResponseData(prev => ({ ...prev, access_type: e.target.value as 'pin' | 'nfc' }))}
                                    className="mr-2"
                                  />
                                  <span className="text-sm">🏷️ Use NFC Card</span>
                                </label>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              {/* NFC Card ID - only show if NFC is selected */}
                              {responseData.access_type === 'nfc' && (
                                <div>
                                  <label className="block text-xs text-gray-600 mb-1">NFC Card ID</label>
                                  <div className="flex gap-1">
                                    <input
                                      type="text"
                                      value={responseData.nfc_card_id}
                                      onChange={(e) => setResponseData(prev => ({ ...prev, nfc_card_id: e.target.value }))}
                                      placeholder="Enter NFC ID or scan"
                                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <button
                                      onClick={() => handleScanNFC(request.id)}
                                      disabled={isLoading}
                                      className="px-2 py-1 bg-purple-500 text-white text-xs rounded hover:bg-purple-600 disabled:bg-gray-300 transition-all duration-200"
                                      title="Activate ESP32 NFC scanning"
                                    >
                                      🔍
                                    </button>
                                  </div>
                                </div>
                              )}
                              
                              {/* Admin Notes */}
                              <div className={responseData.access_type === 'pin' ? 'md:col-span-2' : ''}>
                                <label className="block text-xs text-gray-600 mb-1">Admin Notes</label>
                                <input
                                  type="text"
                                  value={responseData.admin_notes}
                                  onChange={(e) => setResponseData(prev => ({ ...prev, admin_notes: e.target.value }))}
                                  placeholder="Optional notes"
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>
                              
                              {/* Action Buttons */}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    setResponseData(prev => ({ ...prev, action: 'approve' }));
                                    handleRespondToRequest(request.id);
                                  }}
                                  disabled={isLoading || (responseData.access_type === 'nfc' && !responseData.nfc_card_id)}
                                  className="flex-1 px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600 disabled:bg-gray-300 transition-all duration-200"
                                >
                                  ✅ Approve
                                </button>
                                <button
                                  onClick={() => {
                                    setResponseData(prev => ({ ...prev, action: 'reject' }));
                                    handleRespondToRequest(request.id);
                                  }}
                                  disabled={isLoading}
                                  className="flex-1 px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600 disabled:bg-gray-300 transition-all duration-200"
                                >
                                  ❌ Reject
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {request.status !== 'pending' && (
                          <div className="mt-3 p-3 bg-gray-50 rounded">
                            {request.status === 'approved' && (
                              <div className="mb-2">
                                <p className="text-sm font-semibold text-green-700 mb-2">✅ Access Granted:</p>
                                {request.access_type === 'pin' && request.pin_code && (
                                  <div className="p-2 bg-blue-50 rounded border border-blue-200">
                                    <p className="text-sm"><strong>PIN Code:</strong> <code className="bg-white px-2 py-1 rounded font-mono text-lg">{request.pin_code}</code></p>
                                    <p className="text-xs text-blue-600 mt-1">User can enter this PIN on the keypad</p>
                                  </div>
                                )}
                                {request.access_type === 'nfc' && request.nfc_card_id && (
                                  <div className="p-2 bg-purple-50 rounded border border-purple-200">
                                    <p className="text-sm"><strong>NFC Card ID:</strong> <code className="bg-white px-2 py-1 rounded font-mono">{request.nfc_card_id}</code></p>
                                    <p className="text-xs text-purple-600 mt-1">User can tap this NFC card on the reader</p>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {request.admin_notes && (
                              <p className="text-sm text-gray-700"><strong>Admin Notes:</strong> {request.admin_notes}</p>
                            )}
                            
                            {request.approved_by && request.approved_at && (
                              <p className="text-xs text-gray-500 mt-2">
                                {request.status === 'approved' ? 'Approved' : 'Rejected'} by {request.approved_by} on {new Date(request.approved_at).toLocaleString()}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No NFC requests found</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Modal */}
        {confirmDelete && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-mx-4 shadow-xl">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                ⚠️ Xác nhận xóa
              </h3>
              <p className="text-gray-600 mb-6">
                {confirmDelete.value === 'ALL_CODES' ? (
                  <>
                    Bạn có chắc chắn muốn <span className="font-bold text-red-600">xóa tất cả {codes.length} mã</span> đang hoạt động không?
                  </>
                ) : confirmDelete.value === 'ALL_CARDS' ? (
                  <>
                    Bạn có chắc chắn muốn <span className="font-bold text-red-600">hủy đăng ký tất cả {cards.length} thẻ</span> không?
                  </>
                ) : (
                  <>
                    Bạn có chắc chắn muốn {confirmDelete.type === 'code' ? 'xóa mã' : 'hủy đăng ký thẻ'}{' '}
                    <span className="font-mono font-bold text-red-600">{confirmDelete.value}</span> không?
                  </>
                )}
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={cancelDelete}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-all duration-200"
                >
                  Hủy
                </button>
                <button
                  onClick={executeDelete}
                  disabled={isLoading}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 transition-all duration-200"
                >
                  {isLoading ? '⏳ Đang xử lý...' : 
                   confirmDelete.value === 'ALL_CODES' || confirmDelete.value === 'ALL_CARDS' ? '🗑️ Xóa tất cả' : '🗑️ Xóa'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-gray-500">
          <p>🚀 Hệ thống IoT ESP32 - Phiên bản 1.0</p>
        </div>
      </div>
    </div>
  );
}