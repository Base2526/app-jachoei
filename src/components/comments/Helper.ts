// src/components/comments/Helper.ts
export function insertCommentIntoTree(prevComments: any[], newComment: any): any[] {
  const exists = (comments: any[]): boolean => {
    for (const c of comments) {
      if (c.id === newComment.id) return true;
      if (c.replies && c.replies.length && exists(c.replies)) return true;
    }
    return false;
  };

  if (exists(prevComments)) return prevComments;

  if (!newComment.parent_id) {
    return [...prevComments, { ...newComment, replies: newComment.replies ?? [] }];
  }

  const deepInsert = (comments: any[]): any[] =>
    comments.map((c) => {
      if (c.id === newComment.parent_id) {
        const currentReplies = c.replies ?? [];
        return {
          ...c,
          replies: [...currentReplies, { ...newComment, replies: newComment.replies ?? [] }],
        };
      }

      if (c.replies && c.replies.length) {
        return { ...c, replies: deepInsert(c.replies) };
      }
      return c;
    });

  return deepInsert(prevComments);
}

export function formatTimeAgo(createdAt: any) {
  if (!createdAt) return "";

  const timestamp = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt;
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) {
    const sec = Math.floor(Math.abs(diffMs) / 1000);
    if (sec < 60) return "in a few seconds";
    const min = Math.floor(sec / 60);
    if (min < 60) return `in ${min} minute${min > 1 ? "s" : ""}`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `in ${hour} hour${hour > 1 ? "s" : ""}`;
    const day = Math.floor(hour / 24);
    if (day < 30) return `in ${day} day${day > 1 ? "s" : ""}`;
    const month = Math.floor(day / 30);
    if (month < 12) return `in ${month} month${month > 1 ? "s" : ""}`;
    const year = Math.floor(month / 12);
    return `in ${year} year${year > 1 ? "s" : ""}`;
  }

  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min > 1 ? "s" : ""} ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} hour${hour > 1 ? "s" : ""} ago`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} day${day > 1 ? "s" : ""} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month > 1 ? "s" : ""} ago`;
  const year = Math.floor(month / 12);
  return `${year} year${year > 1 ? "s" : ""} ago`;
}
