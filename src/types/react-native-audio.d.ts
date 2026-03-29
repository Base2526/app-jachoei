declare module "react-native-audio" {
  export const AudioUtils: {
    DocumentDirectoryPath: string;
    CachesDirectoryPath: string;
    LibraryDirectoryPath: string;
  };

  export type RecordingOptions = {
    SampleRate?: number;
    Channels?: number;
    AudioQuality?: "Low" | "Medium" | "High" | string;
    AudioEncoding?: string;
    IncludeBase64?: boolean;

    MeteringEnabled?: boolean;

    AudioEncodingBitRate?: number;
    OutputFormat?: string;
    AudioSource?: number;
  };

  export type RecordingProgress = {
    currentTime?: number;
    currentMetering?: number;
    currentPeakMetering?: number;
  };

  export type RecordingFinishedEvent = {
    status?: "OK" | string;
    audioFileURL?: string;
    base64?: string;
    duration?: number;
  };

  export const AudioRecorder: {
    prepareRecordingAtPath(path: string, options?: RecordingOptions): void;
    startRecording(): Promise<void>;
    stopRecording(): Promise<string>;
    pauseRecording(): Promise<void>;
    resumeRecording(): Promise<void>;

    onProgress?: (data: RecordingProgress) => void;
    onFinished?: (data: RecordingFinishedEvent) => void;
  };
}
