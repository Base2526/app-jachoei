declare module "react-native-sound" {
  type Callback = (error?: any) => void;

  export default class Sound {
    static MAIN_BUNDLE: any;

    constructor(filename: string, basePath?: any, callback?: Callback);

    static setCategory(category: string, mixWithOthers?: boolean): void;

    play(onEnd?: (success: boolean) => void): void;
    pause(callback?: Callback): void;
    stop(callback?: Callback): void;
    release(): void;

    getDuration(): number;
    getCurrentTime(callback: (seconds: number) => void): void;
    setCurrentTime(seconds: number): void;
  }
}
