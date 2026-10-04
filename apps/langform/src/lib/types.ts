export type Video = {
  id: string;
  title: string;
  channelName: string;
  channelId: string;
  durationSeconds: number | null;
  viewCount: number | null;
  publishedAt: number | null;
  publishedText: string;
  description: string;
};

export type ChannelInfo = {
  id: string;
  name: string;
  description: string;
  subscriberCount: number | null;
};

export type WatchDetails = {
  video: Video;
  related: Video[];
  blocked: boolean;
};
