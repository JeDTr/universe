// Game-scale solar system (sizes/distances are NOT to scale, so everything fits on screen).
// dist: game units from the Sun (100 units ≈ 1 AU for the inner planets)
// au: real mean orbital radius, used for the real-distance readouts
// period: orbital period (days), rot: rotation period (days, negative = retrograde)
export const BODIES = [
  { id: 'mercury', name: 'Sao Thủy', r: 1.4, dist: 40, au: 0.387, period: 88, rot: 58.6, tilt: 0.03, a0: 200,
    fact: 'Hành tinh nhỏ nhất và gần Mặt Trời nhất. Một năm chỉ dài 88 ngày.' },
  { id: 'venus', name: 'Sao Kim', r: 3.0, dist: 62, au: 0.723, period: 224.7, rot: -243, tilt: 177.4, a0: 130,
    atmo: 0xffcc88, fact: 'Nóng nhất hệ Mặt Trời (~465°C) do hiệu ứng nhà kính, tự quay ngược chiều.' },
  { id: 'earth', name: 'Trái Đất', r: 4.0, dist: 100, au: 1.0, period: 365.25, rot: 1, tilt: 23.4, a0: 0,
    atmo: 0x4f9dff, fact: 'Ngôi nhà của chúng ta — hành tinh duy nhất được biết có sự sống.' },
  { id: 'mars', name: 'Sao Hỏa', r: 2.6, dist: 140, au: 1.524, period: 687, rot: 1.03, tilt: 25.2, a0: 55,
    atmo: 0xff8a5c, fact: 'Hành tinh đỏ, có núi lửa Olympus Mons cao gần 22 km.' },
  { id: 'jupiter', name: 'Sao Mộc', r: 11, dist: 230, au: 5.203, period: 4333, rot: 0.41, tilt: 3.1, a0: 100,
    fact: 'Hành tinh lớn nhất; Vết Đỏ Lớn là cơn bão to hơn cả Trái Đất.' },
  { id: 'saturn', name: 'Sao Thổ', r: 9, dist: 310, au: 9.537, period: 10759, rot: 0.44, tilt: 26.7, a0: 250, rings: true,
    fact: 'Nổi tiếng với hệ vành đai băng đá rộng hơn 270.000 km.' },
  { id: 'uranus', name: 'Sao Thiên Vương', r: 6, dist: 380, au: 19.19, period: 30687, rot: -0.72, tilt: 97.8, a0: 30,
    atmo: 0x9fe8f0, fact: 'Nằm nghiêng gần 98°, như đang lăn quanh Mặt Trời.' },
  { id: 'neptune', name: 'Sao Hải Vương', r: 5.8, dist: 440, au: 30.07, period: 60190, rot: 0.67, tilt: 28.3, a0: 300,
    atmo: 0x5a8cff, fact: 'Gió mạnh nhất hệ Mặt Trời, lên tới 2.100 km/h.' },
];

export const MOON = {
  id: 'moon', name: 'Mặt Trăng', r: 1.1, dist: 11, period: 27.32, tilt: 6.7,
  fact: 'Cách Trái Đất ~384.400 km, luôn hướng một mặt về phía chúng ta.',
};

export const SUN = {
  id: 'sun', name: 'Mặt Trời', r: 16,
  fact: 'Chiếm 99,86% khối lượng hệ Mặt Trời. Ánh sáng mất ~8,3 phút để tới Trái Đất.',
};

export const AU_KM = 149.6e6;
export const LIGHT_KMS = 299792.458;
