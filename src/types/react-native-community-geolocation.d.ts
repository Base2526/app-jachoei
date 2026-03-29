declare module "@react-native-community/geolocation" {
  export type GeoPosition = {
    coords: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      altitude?: number | null;
      heading?: number | null;
      speed?: number | null;
    };
    timestamp?: number;
  };

  export type GeoError = {
    code: number;
    message: string;
  };

  export type GeoOptions = {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
    distanceFilter?: number;
  };

  export type AuthorizationLevel = "whenInUse" | "always";

  const Geolocation: {
    getCurrentPosition: (
      success: (position: GeoPosition) => void,
      error?: (error: GeoError) => void,
      options?: GeoOptions
    ) => void;

    requestAuthorization?: (level?: AuthorizationLevel) => void;
  };

  export default Geolocation;
}
