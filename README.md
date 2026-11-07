# Universe

Game khám phá hệ Mặt Trời 3D bằng Three.js — nhìn về Trái Đất từ quỹ đạo Sao Hỏa, lái tàu vũ trụ đi quét các hành tinh.

```bash
npm install
npm run dev
```

- `1` Quỹ đạo Sao Hỏa — cuộn chuột để zoom kính viễn vọng về Trái Đất
- `2` Tàu vũ trụ — W/S đẩy, kéo chuột lái, Shift tăng tốc, giữ Space để quét (nhiệm vụ: quét 9 thiên thể)
- `3` Quan sát — xoay quanh hành tinh bất kỳ (nhấp tên hành tinh)
- `L` bật/tắt nhãn, `O` bật/tắt quỹ đạo

Mọi texture hành tinh được sinh thủ tục bằng noise (`src/textures.js`), không cần tải ảnh ngoài.
Kích thước và khoảng cách không theo tỉ lệ thật; số km hiển thị dùng bán kính quỹ đạo thật.
