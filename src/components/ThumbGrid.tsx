import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
} from "react-native";
import ImageViewing from "react-native-image-viewing";

import { ENV } from "../config/env";

export type ThumbImage = {
  id: string | number;
  url: string;
};

function resolveImageUri(url?: string | null) {
  if (!url) return "";

  const value = String(url).trim();
  if (!value) return "";

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("file://") ||
    value.startsWith("content://") ||
    value.startsWith("data:")
  ) {
    return value;
  }

  const base = ENV.apiBase.endsWith("/") ? ENV.apiBase.slice(0, -1) : ENV.apiBase;
  if (value.startsWith("/")) return `${base}${value}`;
  return `${base}/${value}`;
}

type Props = {
  images: ThumbImage[];
  width: number;
  height: number;
  radius?: number;
  gap?: number;
  layout?: "default" | "tablet";
};

export const ThumbGrid: React.FC<Props> = ({
  images,
  width,
  height,
  radius = 12,
  gap = 6,
  layout = "default",
}) => {
  const list = (images || []).filter((img) => !!img && !!String((img as any).url || "").trim());
  const count = list.length;
  const thumbCount = Math.min(count, 5);

  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);

  /** ===============================
   * Preview images (ImageViewing)
   * =============================== */
  const previewImages = useMemo(
    () =>
      list.map((img) => ({
        uri: resolveImageUri(img.url),
      })),
    [list]
  );

  const openAt = useCallback((idx: number) => {
    setCurrent(idx);
    setVisible(true);
  }, []);

  const cell = useCallback(
    (
      img: ThumbImage,
      idx: number,
      style?: any,
      overlay?: React.ReactNode
    ) => (
      <TouchableOpacity
        key={String(img.id)}
        activeOpacity={0.9}
        onPress={() => openAt(idx)}
        style={[
          {
            borderRadius: radius,
            overflow: "hidden",
            backgroundColor: "#0f0f14",
          },
          style,
        ]}
      >
        <Image
          source={{ uri: resolveImageUri(img.url) }}
          resizeMode="cover"
          style={{ width: "100%", height: "100%" }}
        />
        {overlay}
      </TouchableOpacity>
    ),
    [openAt, radius]
  );

  const boxStyle = useMemo(
    () => ({
      width,
      height,
      borderRadius: radius,
      overflow: "hidden" as const,
      backgroundColor: "#0f0f14",
    }),
    [width, height, radius]
  );

  /** ===============================
   * Thumbnail layouts
   * =============================== */
  const renderThumb = useMemo(() => {
    if (!count) return <Text style={{ color: "#9ca3af" }}>—</Text>;

    // 1 รูป
    if (thumbCount === 1) {
      return <View style={boxStyle}>{cell(list[0], 0, { flex: 1 })}</View>;
    }

    // 2 รูป
    if (thumbCount === 2) {
      return (
        <View style={[boxStyle, { flexDirection: "row", gap }]}>
          <View style={{ flex: 1 }}>{cell(list[0], 0, { flex: 1 })}</View>
          <View style={{ flex: 1 }}>{cell(list[1], 1, { flex: 1 })}</View>
        </View>
      );
    }

    // 3 รูป
    if (thumbCount === 3) {
      if (layout === "tablet") {
        return (
          <View style={[boxStyle, { flexDirection: "row", gap }]}>
            <View style={{ flex: 1.28 }}>
              {cell(list[0], 0, { height: "100%" })}
            </View>
            <View style={{ flex: 1, gap }}>
              <View style={{ flex: 1 }}>{cell(list[1], 1, { flex: 1 })}</View>
              <View style={{ flex: 1 }}>{cell(list[2], 2, { flex: 1 })}</View>
            </View>
          </View>
        );
      }

      const topH = Math.round(height * 0.56);
      const bottomH = height - topH - gap;

      return (
        <View style={boxStyle}>
          <View style={{ height: topH, marginBottom: gap }}>
            {cell(list[0], 0, { flex: 1 })}
          </View>
          <View style={{ height: bottomH, flexDirection: "row", gap }}>
            <View style={{ flex: 1 }}>{cell(list[1], 1, { flex: 1 })}</View>
            <View style={{ flex: 1 }}>{cell(list[2], 2, { flex: 1 })}</View>
          </View>
        </View>
      );
    }

    // 4 รูป
    if (thumbCount === 4) {
      return (
        <View style={[boxStyle, { flexDirection: "row", gap }]}>
          <View style={{ flex: 1.2 }}>
            {cell(list[0], 0, { height: "100%" })}
          </View>

          <View style={{ flex: 1, gap }}>
            <View style={{ flex: 1 }}>{cell(list[1], 1, { flex: 1 })}</View>
            <View style={{ flex: 1, flexDirection: "row", gap }}>
              <View style={{ flex: 1 }}>{cell(list[2], 2, { flex: 1 })}</View>
              <View style={{ flex: 1 }}>{cell(list[3], 3, { flex: 1 })}</View>
            </View>
          </View>
        </View>
      );
    }

    // 5+ รูป
    const overlay =
      count > 5 ? (
        <View style={styles.moreOverlay}>
          <Text style={styles.moreText}>+{count - 5}</Text>
        </View>
      ) : null;

    return (
      <View style={[boxStyle, { flexDirection: "row", gap }]}>
        <View style={{ flex: 1.2 }}>
          {cell(list[0], 0, { height: "100%" })}
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, flexDirection: "row", gap, marginBottom: gap }}>
            <View style={{ flex: 1 }}>{cell(list[1], 1, { flex: 1 })}</View>
            <View style={{ flex: 1 }}>{cell(list[2], 2, { flex: 1 })}</View>
          </View>
          <View style={{ flex: 1, flexDirection: "row", gap }}>
            <View style={{ flex: 1 }}>{cell(list[3], 3, { flex: 1 })}</View>
            <View style={{ flex: 1 }}>
              {cell(list[4], 4, { flex: 1 }, overlay)}
            </View>
          </View>
        </View>
      </View>
    );
  }, [count, thumbCount, boxStyle, cell, list, gap, height, layout]);

  return (
    <>
      {renderThumb}

      {/* ===============================
          Fullscreen Image Preview
         =============================== */}
      <ImageViewing
        images={previewImages}
        imageIndex={current}
        visible={visible}
        onRequestClose={() => setVisible(false)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
      />
    </>
  );
};

const styles = StyleSheet.create({
  moreOverlay: {
    position: "absolute",
    right: 6,
    bottom: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  moreText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
});
