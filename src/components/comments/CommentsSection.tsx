// src/components/comments/CommentsSection.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { gql } from "@apollo/client";
import Ionicons from "react-native-vector-icons/Ionicons";

import { client } from "../../apollo/client";
import { insertCommentIntoTree, formatTimeAgo } from "./Helper";

type User = { id: string; name: string; avatar?: string | null };

export type CommentNode = {
  id: string;
  post_id: string;
  user_id: string;
  parent_id?: string | null;
  content: string;
  created_at: any;
  user?: User | null;
  replies?: CommentNode[];
};

type CommentsQueryData = { comments: CommentNode[] };
type CommentsQueryVars = { post_id: string };

type AddCommentData = { addComment: CommentNode };
type AddCommentVars = { post_id: string; content: string };

type ReplyCommentData = { replyComment: CommentNode };
type ReplyCommentVars = { comment_id: string; content: string };

type UpdateCommentData = { updateComment: { id: string; content: string; updated_at?: any } };
type UpdateCommentVars = { id: string; content: string };

type DeleteCommentData = { deleteComment: boolean };
type DeleteCommentVars = { id: string };

type SubAddedData = { commentAdded: CommentNode };
type SubAddedVars = { post_id: string };

const Q_COMMENTS = gql`
  query Comments($post_id: ID!) {
    comments(post_id: $post_id) {
      id
      post_id
      user_id
      parent_id
      content
      created_at
      user { id name avatar }
      replies {
        id
        post_id
        user_id
        parent_id
        content
        created_at
        user { id name avatar }
      }
    }
  }
`;

const MUT_ADD = gql`
  mutation AddComment($post_id: ID!, $content: String!) {
    addComment(post_id: $post_id, content: $content) {
      id
      post_id
      user_id
      parent_id
      content
      created_at
      user { id name avatar }
      replies { id }
    }
  }
`;

const MUT_REPLY = gql`
  mutation ReplyComment($comment_id: ID!, $content: String!) {
    replyComment(comment_id: $comment_id, content: $content) {
      id
      post_id
      user_id
      parent_id
      content
      created_at
      user { id name avatar }
    }
  }
`;

const MUT_UPDATE = gql`
  mutation UpdateComment($id: ID!, $content: String!) {
    updateComment(id: $id, content: $content) {
      id
      content
      updated_at
    }
  }
`;

const MUT_DELETE = gql`
  mutation DeleteComment($id: ID!) {
    deleteComment(id: $id)
  }
`;

const SUB_ADDED = gql`
  subscription CommentAdded($post_id: ID!) {
    commentAdded(post_id: $post_id) {
      id
      post_id
      user_id
      parent_id
      content
      created_at
      user { id name avatar }
    }
  }
`;

// ---------- mention renderer ----------
function parseMention(content: string): { userId: string; displayName: string; rest: string } | null {
  const match = content.match(/^@\[(.+?):(.+?)\]\s*(.*)$/);
  if (!match) return null;
  const [, userId, displayName, rest] = match;
  return { userId, displayName, rest };
}

function CommentContent({ content }: { content: string }) {
  const m = parseMention(content);
  if (!m) {
    return <Text style={styles.commentText}>{content}</Text>;
  }
  return (
    <Text style={styles.commentText}>
      <Text style={styles.mentionText}>@{m.displayName}</Text> {m.rest}
    </Text>
  );
}

// ---------- single comment item ----------
function CommentItem({
  comment,
  currentUserId,
  onReply,
  onUpdate,
  onDelete,
  rootId,
  level = 1,
}: {
  comment: CommentNode;
  currentUserId?: string | number;
  onReply: (rootCommentId: string, content: string, tagUser?: User | null) => void;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  rootId?: string;
  level?: 1 | 2;
}) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.content);
  const [replyText, setReplyText] = useState("");
  const [showReplies, setShowReplies] = useState(false);

  const isLoggedIn = !!currentUserId;
  const canEdit = isLoggedIn && String(currentUserId) === String(comment.user_id);

  const rootCommentId = rootId ?? comment.id;
  const replyCount = comment.replies?.length ?? 0;

  const userName = comment.user?.name || "Unknown";
  const timeAgo = formatTimeAgo(comment.created_at);

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={styles.commentHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>{userName}</Text>
          <Text style={styles.timeAgo}>{timeAgo}</Text>
        </View>
      </View>

      {!editing ? (
        <CommentContent content={comment.content} />
      ) : (
        <View style={{ marginTop: 6 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            style={styles.textArea}
            multiline
            placeholderTextColor="#666"
          />
          <View style={styles.inlineRow}>
            <Pressable
              style={[styles.smallBtn, styles.primaryBtn]}
              onPress={() => {
                onUpdate(comment.id, text);
                setEditing(false);
              }}
            >
              <Text style={styles.smallBtnText}>Save</Text>
            </Pressable>
            <Pressable style={styles.smallBtn} onPress={() => setEditing(false)}>
              <Text style={styles.smallBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* actions */}
      {isLoggedIn && (
        <View style={styles.inlineRow}>
          <Pressable
            style={styles.actionBtn}
            onPress={() => setReplying((v) => !v)}
          >
            <Text style={styles.actionText}>Reply</Text>
          </Pressable>

          {canEdit && !editing && (
            <>
              <Pressable style={styles.actionBtn} onPress={() => setEditing(true)}>
                <Text style={styles.actionText}>Edit</Text>
              </Pressable>

              <Pressable
                style={styles.actionBtn}
                onPress={() =>
                  Alert.alert("Delete", "Delete this comment?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => onDelete(comment.id) },
                  ])
                }
              >
                <Text style={[styles.actionText, { color: "#ef4444" }]}>Delete</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* reply box */}
      {isLoggedIn && replying && (
        <View style={{ marginTop: 8 }}>
          <TextInput
            value={replyText}
            onChangeText={setReplyText}
            style={styles.textArea}
            multiline
            placeholder="Write a reply..."
            placeholderTextColor="#666"
          />
          <Pressable
            style={[styles.smallBtn, styles.primaryBtn, { alignSelf: "flex-start", marginTop: 6 }]}
            onPress={() => {
              onReply(rootCommentId, replyText, comment.user ?? null);
              setReplyText("");
              setReplying(false);
            }}
            disabled={!replyText.trim()}
          >
            <Text style={styles.smallBtnText}>Reply</Text>
          </Pressable>
        </View>
      )}

      {/* show/hide replies (only level 1) */}
      {level === 1 && replyCount > 0 && (
        <Pressable
          onPress={() => setShowReplies((v) => !v)}
          style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          <Ionicons name={showReplies ? "chevron-up" : "chevron-down"} size={16} color="#9ca3af" />
          <Text style={styles.repliesToggleText}>
            {showReplies ? "Hide replies" : `${replyCount} replies`}
          </Text>
        </Pressable>
      )}

      {/* replies */}
      {level === 1 && replyCount > 0 && showReplies && (
        <View style={styles.repliesBox}>
          {(comment.replies || []).map((r) => (
            <CommentItem
              key={r.id}
              comment={r}
              currentUserId={currentUserId}
              onReply={onReply}
              onUpdate={onUpdate}
              onDelete={onDelete}
              rootId={rootCommentId}
              level={2}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ---------- main section ----------
export function CommentsSection({
  postId,
  currentUserId,
}: {
  postId: string;
  currentUserId?: string | number;
}) {
  const [newText, setNewText] = useState("");
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isLoggedIn = !!currentUserId;

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.query<CommentsQueryData, CommentsQueryVars>({
        query: Q_COMMENTS,
        variables: { post_id: postId },
        fetchPolicy: "network-only",
      });
      if (!mountedRef.current) return;
      setComments(res.data?.comments ?? []);
    } catch (e: any) {
      console.log("[CommentsSection] load error =", e?.message || e);
      if (!mountedRef.current) return;
      setComments([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // ✅ subscription: new comment added
  useEffect(() => {
    const sub = client
      .subscribe<SubAddedData, SubAddedVars>({
        query: SUB_ADDED,
        variables: { post_id: postId },
      })
      .subscribe({
        next: ({ data }) => {
          const newComment = data?.commentAdded;
          if (!newComment) return;

          setComments((prev) => insertCommentIntoTree(prev, newComment));
        },
        error: (err) => {
          console.log("[SUB_ADDED] error =", err?.message || err);
        },
      });

    return () => sub.unsubscribe();
  }, [postId]);

  const handleAdd = useCallback(async () => {
    if (!isLoggedIn) {
      Alert.alert("ต้องเข้าสู่ระบบ", "กรุณาเข้าสู่ระบบก่อนแสดงความคิดเห็น");
      return;
    }
    if (!newText.trim()) return;

    setBusy(true);
    try {
      await client.mutate<AddCommentData, AddCommentVars>({
        mutation: MUT_ADD,
        variables: { post_id: postId, content: newText.trim() },
      });

      setNewText("");
      // จะ refetch หรือไม่ก็ได้ เพราะ subscription จะเติมให้เอง
      // แต่เพื่อชัวร์ในกรณี server ไม่ broadcast ให้ sender:
      await loadComments();
    } catch (e: any) {
      console.log("[CommentsSection] add error =", e?.message || e);
      Alert.alert("Error", "Add comment failed");
    } finally {
      setBusy(false);
    }
  }, [isLoggedIn, newText, postId, loadComments]);

  const handleReply = useCallback(
    async (rootCommentId: string, content: string, tagUser?: User | null) => {
      if (!isLoggedIn) {
        Alert.alert("ต้องเข้าสู่ระบบ", "กรุณาเข้าสู่ระบบก่อนตอบคอมเมนต์");
        return;
      }
      if (!content.trim()) return;

      const finalContent = tagUser
        ? `@[${tagUser.id}:${tagUser.name}] ${content.trim()}`
        : content.trim();

      setBusy(true);
      try {
        await client.mutate<ReplyCommentData, ReplyCommentVars>({
          mutation: MUT_REPLY,
          variables: { comment_id: rootCommentId, content: finalContent },
        });

        await loadComments();
      } catch (e: any) {
        console.log("[CommentsSection] reply error =", e?.message || e);
        Alert.alert("Error", "Reply failed");
      } finally {
        setBusy(false);
      }
    },
    [isLoggedIn, loadComments]
  );

  const handleUpdate = useCallback(
    async (id: string, content: string) => {
      if (!isLoggedIn) {
        Alert.alert("ต้องเข้าสู่ระบบ", "กรุณาเข้าสู่ระบบก่อนแก้ไขคอมเมนต์");
        return;
      }
      if (!content.trim()) return;

      setBusy(true);
      try {
        await client.mutate<UpdateCommentData, UpdateCommentVars>({
          mutation: MUT_UPDATE,
          variables: { id, content: content.trim() },
        });
        await loadComments();
      } catch (e: any) {
        console.log("[CommentsSection] update error =", e?.message || e);
        Alert.alert("Error", "Update failed");
      } finally {
        setBusy(false);
      }
    },
    [isLoggedIn, loadComments]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!isLoggedIn) {
        Alert.alert("ต้องเข้าสู่ระบบ", "กรุณาเข้าสู่ระบบก่อนลบคอมเมนต์");
        return;
      }

      setBusy(true);
      try {
        await client.mutate<DeleteCommentData, DeleteCommentVars>({
          mutation: MUT_DELETE,
          variables: { id },
        });
        await loadComments();
      } catch (e: any) {
        console.log("[CommentsSection] delete error =", e?.message || e);
        Alert.alert("Error", "Delete failed");
      } finally {
        setBusy(false);
      }
    },
    [isLoggedIn, loadComments]
  );

  if (loading) {
    return (
      <View style={{ paddingVertical: 12 }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View>
      {/* New comment box */}
      <View style={styles.newBox}>
        {isLoggedIn ? (
          <>
            <TextInput
              value={newText}
              onChangeText={setNewText}
              style={styles.textArea}
              multiline
              placeholder="Write a comment..."
              placeholderTextColor="#666"
            />

            <Pressable
              style={[styles.bigBtn, (!newText.trim() || busy) && { opacity: 0.5 }]}
              onPress={handleAdd}
              disabled={!newText.trim() || busy}
            >
              <Text style={styles.bigBtnText}>{busy ? "..." : "Comment"}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={{ color: "#9ca3af" }}>
            กรุณาเข้าสู่ระบบเพื่อแสดงความคิดเห็น
          </Text>
        )}
      </View>

      {/* list */}
      {comments.length === 0 ? (
        <Text style={{ color: "#9ca3af" }}>No comments yet.</Text>
      ) : (
        comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            currentUserId={currentUserId}
            onReply={handleReply}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            rootId={c.id}
            level={1}
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  newBox: {
    marginBottom: 16,
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 12,
    padding: 10,
  },
  textArea: {
    minHeight: 70,
    borderRadius: 10,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#333",
    color: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    textAlignVertical: "top",
  },
  bigBtn: {
    marginTop: 8,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  bigBtnText: { color: "#fff", fontWeight: "700" },

  commentHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  userName: { color: "#fff", fontWeight: "700", fontSize: 14 },
  timeAgo: { color: "#9ca3af", fontSize: 11, marginTop: 2 },

  commentText: { color: "#e5e7eb", fontSize: 14, lineHeight: 20 },
  mentionText: { color: "#60a5fa", fontWeight: "800" },

  inlineRow: { flexDirection: "row", gap: 10, marginTop: 6, alignItems: "center" },
  actionBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  actionText: { color: "#9ca3af", fontSize: 12, fontWeight: "700" },

  smallBtn: {
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  primaryBtn: { backgroundColor: "#2563eb", borderColor: "#3b82f6" },
  smallBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  repliesToggleText: { color: "#9ca3af", fontWeight: "700", fontSize: 12 },

  repliesBox: {
    marginTop: 8,
    paddingLeft: 14,
    borderLeftWidth: 1,
    borderLeftColor: "#222",
  },
});
