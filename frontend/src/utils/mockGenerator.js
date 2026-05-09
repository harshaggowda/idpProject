import api from './api';

const MOCK_LOCATIONS = [
  { lat: 12.9716, lng: 77.5946 }, // Bangalore Center
  { lat: 12.9352, lng: 77.6245 }, // Koramangala
  { lat: 12.9250, lng: 77.5938 }, // Jayanagar
  { lat: 12.9784, lng: 77.6408 }, // Indiranagar
];

export const generateMockData = async () => {
  try {
    for (let i = 0; i < 10; i++) {
      // Pick a random base location and add slight offset (roughly within 1km)
      const baseLoc = MOCK_LOCATIONS[Math.floor(Math.random() * MOCK_LOCATIONS.length)];
      const latOffset = (Math.random() - 0.5) * 0.01;
      const lngOffset = (Math.random() - 0.5) * 0.01;
      
      const type = Math.random() > 0.5 ? 'pothole' : 'hump';
      const severity = ['low', 'medium', 'high'][Math.floor(Math.random() * 3)];

      await api.post('/events', {
        latitude: baseLoc.lat + latOffset,
        longitude: baseLoc.lng + lngOffset,
        type,
        severity
      });
      
      // Also maybe create a cluster nearby to test clustering
      if (Math.random() > 0.7) {
        await api.post('/events', {
          latitude: baseLoc.lat + latOffset + 0.00005, // very close (~5.5m)
          longitude: baseLoc.lng + lngOffset + 0.00005,
          type,
          severity
        });
      }
    }
    console.log("Mock data generated successfully.");
  } catch (error) {
    console.error("Failed to generate mock data:", error);
  }
};
