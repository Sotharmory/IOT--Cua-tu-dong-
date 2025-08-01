# IoT Backend System - Hệ thống Quản lý Truy cập IoT

## **Tổng quan**

Backend này là một hệ thống quản lý truy cập IoT hoàn chỉnh, sử dụng Express.js làm web server, SQLite làm cơ sở dữ liệu, MQTT để giao tiếp với ESP32, và Socket.IO cho real-time communication.

## **Kiến trúc hệ thống**

### **Công nghệ sử dụng:**
- **Express.js** - Web server framework
- **SQLite** - Cơ sở dữ liệu nhẹ
- **MQTT** - Giao thức giao tiếp với ESP32
- **Socket.IO** - Real-time communication
- **JWT** - Xác thực và phân quyền
- **bcrypt** - Mã hóa mật khẩu

### **Cấu trúc Database:**

```sql
-- Bảng mật khẩu tạm thời
passwords (code, type, expires_at)

-- Bảng thẻ NFC
nfc_cards (id, enrolled_at)

-- Bảng logs truy cập
logs (id, method, code, success, time, user_name, user_id)

-- Bảng người dùng ESP32 (offline)
esp32_users (id, name, username, pin, nfc_id, auth_type, is_active, synced_to_esp32)

-- Bảng trạng thái ESP32
esp32_status (id, last_sync, user_count, failed_attempts, lockout_time, is_online)

-- Bảng admin users
admin_users (id, username, email, password_hash, full_name, role, is_active)

-- Bảng guest accounts
guest_accounts (id, username, email, password_hash, full_name, phone, approval_status)

-- Bảng yêu cầu NFC từ guest
nfc_requests (id, guest_id, reason, requested_at, expires_at, status, access_type, pin_code)
```

## **Cơ chế hoạt động**

### **1. Xác thực và Truy cập**

#### **Các phương thức xác thực:**
1. **Mật khẩu 6 chữ số** (OTP/Static) - Tạm thời
2. **Thẻ NFC** - Truy cập bằng thẻ
3. **PIN code** (4-8 chữ số) - Cho ESP32 users
4. **JWT Token** - Cho admin/guest accounts

#### **Quy trình xác thực:**
```javascript
// Khi có request unlock
1. Kiểm tra PIN ESP32 user
2. Kiểm tra NFC ESP32 user  
3. Kiểm tra mật khẩu 6 chữ số
4. Kiểm tra thẻ NFC
5. Gửi lệnh mở cửa qua MQTT
```

### **2. Giao tiếp với ESP32 qua MQTT**

#### **Topics MQTT:**
- `mytopic/open` - Lệnh mở cửa
- `mytopic/rfid` - Nhận ID thẻ NFC
- `mytopic/pin` - Nhận PIN từ ESP32
- `admin/add-user` - Thêm user vào ESP32
- `admin/remove-user` - Xóa user khỏi ESP32
- `admin/system-status` - Lấy trạng thái ESP32
- `admin/response` - Phản hồi từ ESP32

### **3. Hệ thống phân quyền**

#### **Admin System:**
- Quản lý mật khẩu tạm thời
- Quản lý thẻ NFC
- Quản lý user ESP32
- Duyệt yêu cầu từ guest
- Xem logs truy cập
- Quản lý tài khoản guest

#### **Guest System:**
- Đăng ký tài khoản (cần admin duyệt)
- Yêu cầu quyền truy cập (NFC/PIN)
- Xem logs cá nhân
- Quản lý profile

### **4. Real-time Communication**

#### **Socket.IO Events:**
- `esp32-response` - Phản hồi từ ESP32
- `nfc-detected` - Phát hiện thẻ NFC
- `pin-entered` - PIN được nhập
- `log-update` - Cập nhật logs
- `password-update` - Cập nhật mật khẩu
- `nfc-update` - Cập nhật thẻ NFC
- `esp32-user-update` - Cập nhật user ESP32
- `new-nfc-request` - Yêu cầu NFC mới
- `user-approval-update` - Cập nhật duyệt user

## **API Endpoints**

### **Authentication:**
- `POST /api/auth/admin/login` - Đăng nhập admin
- `POST /api/auth/admin/register` - Đăng ký admin (cần admin khác)
- `POST /api/auth/guest/login` - Đăng nhập guest
- `POST /api/auth/guest/register` - Đăng ký guest
- `POST /api/auth/verify` - Xác thực token
- `POST /api/auth/refresh` - Làm mới token

### **Access Control:**
- `POST /api/unlock` - Mở cửa (xác thực)
- `POST /api/open` - Mở cửa (admin only)
- `POST /api/create-code` - Tạo mật khẩu tạm thời
- `POST /api/delete-code` - Xóa mật khẩu
- `POST /api/enroll` - Đăng ký thẻ NFC
- `POST /api/disenroll` - Hủy thẻ NFC

### **ESP32 Management:**
- `POST /api/esp32/add-user` - Thêm user ESP32
- `POST /api/esp32/remove-user` - Xóa user ESP32
- `POST /api/esp32/assign-pin` - Gán PIN cho user
- `GET /api/esp32/users` - Lấy danh sách users
- `GET /api/esp32/status` - Lấy trạng thái ESP32
- `POST /api/esp32/reset` - Reset ESP32

### **Guest Management:**
- `GET /api/admin/guests` - Lấy danh sách guests
- `POST /api/admin/guests/:id/approve` - Duyệt/từ chối guest
- `POST /api/admin/guests/:id/toggle` - Bật/tắt tài khoản
- `DELETE /api/admin/guests/:id` - Xóa tài khoản
- `POST /api/guest/request-nfc` - Yêu cầu quyền truy cập
- `GET /api/guest/my-requests` - Xem yêu cầu của mình
- `GET /api/guest/my-logs` - Xem logs cá nhân

### **Logs & Monitoring:**
- `GET /api/logs` - Xem logs truy cập (có pagination)
- `GET /api/active-passwords` - Mật khẩu đang hoạt động
- `GET /api/active-nfc-cards` - Thẻ NFC đang hoạt động

## **Cơ chế bảo mật**

### **Authentication:**
- JWT tokens với expiration (24h cho admin, 7d cho guest)
- Password hashing với bcrypt (10 rounds)
- Role-based access control
- Token refresh mechanism

### **Data Protection:**
- Mật khẩu được hash với bcrypt
- Tokens có thời hạn và có thể refresh
- Input validation cho tất cả endpoints
- SQL injection protection
- CORS configuration

## **Tính năng đặc biệt**

### **Offline Authentication:**
- ESP32 có thể hoạt động offline
- Sync users từ backend qua MQTT
- Local authentication trên ESP32
- Backup authentication khi mất kết nối

### **Auto-expiration:**
- Mật khẩu tự động hết hạn
- Guest PIN tự động xóa sau thời hạn
- Request tự động expire
- System check mỗi phút

### **Audit Trail:**
- Log tất cả attempts truy cập
- Track user actions và thời gian
- Pagination cho logs
- Filter và sort logs
- Export logs capability

### **Real-time Updates:**
- Socket.IO cho real-time updates
- Live notifications cho admin
- Real-time status monitoring
- Instant feedback cho users

## **Cài đặt và Chạy**

### **Dependencies:**
```bash
npm install
```

### **Cấu hình:**
- MQTT Broker: `mqtt://127.0.0.1`
- Port: `3000`
- Database: `codes.db` (SQLite)

### **Chạy server:**
```bash
node index.js
```

### **Default Admin Account:**
- Username: `admin`
- Password: `admin`
- **⚠️ Lưu ý: Đổi mật khẩu trong production!**

## **MQTT Configuration**

### **Connection:**
```javascript
const mqttClient = mqtt.connect('mqtt://127.0.0.1', {
  username: 'caxtiq',
  password: 'anthithhn1N_',
});
```

### **Topics:**
- **Publish:** `mytopic/open`, `admin/add-user`, `admin/remove-user`
- **Subscribe:** `admin/response`, `mytopic/rfid`, `mytopic/pin`

## **Database Schema Details**

### **passwords table:**
- `code` (TEXT PRIMARY KEY) - Mật khẩu 6 chữ số
- `type` (TEXT) - 'static' hoặc 'otp'
- `expires_at` (INTEGER) - Thời gian hết hạn

### **nfc_cards table:**
- `id` (TEXT PRIMARY KEY) - ID thẻ NFC
- `enrolled_at` (INTEGER) - Thời gian đăng ký

### **esp32_users table:**
- `id` (INTEGER PRIMARY KEY) - ID user
- `name` (TEXT) - Tên đầy đủ
- `username` (TEXT) - Username
- `pin` (TEXT) - PIN code
- `nfc_id` (TEXT) - ID thẻ NFC
- `auth_type` (INTEGER) - 1=PIN, 2=NFC, 3=Combined
- `is_active` (INTEGER) - Trạng thái hoạt động
- `synced_to_esp32` (INTEGER) - Đã sync với ESP32 chưa

## **Security Considerations**

1. **Change default admin password** trong production
2. **Use strong JWT secret** thay vì default
3. **Enable HTTPS** trong production
4. **Regular database backups**
5. **Monitor logs** cho suspicious activities
6. **Rate limiting** cho API endpoints
7. **Input sanitization** cho tất cả user inputs

## **Troubleshooting**

### **Common Issues:**
1. **MQTT connection failed** - Kiểm tra MQTT broker
2. **Database locked** - Restart server
3. **ESP32 not responding** - Kiểm tra MQTT topics
4. **JWT expired** - Refresh token

### **Logs:**
- Server logs: Console output
- Access logs: Database `logs` table
- Error logs: Console errors

---

**⚠️ Production Notes:**
- Đổi JWT_SECRET
- Đổi default admin password
- Cấu hình HTTPS
- Backup database regularly
- Monitor system resources 