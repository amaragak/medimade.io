import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";

type Option = {
  label: string;
  value: string;
};

export default function ModalDropdown({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
}: {
  label?: string;
  options: Option[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  const selectedLabel = useMemo(() => {
    if (!value) return null;
    return options.find((o) => o.value === value)?.label ?? null;
  }, [options, value]);

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={selectedLabel ? styles.value : styles.placeholder}>
          {selectedLabel ?? placeholder}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose one</Text>
            <FlatList
              data={options}
              keyExtractor={(item, index) =>
                item.value ? item.value : `__empty_${index}`
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.optionRow,
                    pressed && { backgroundColor: colors.accentSoft },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      item.value === value && { color: colors.accent },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 8,
  },
  trigger: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  value: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  placeholder: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: "70%",
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  optionRow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  optionText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.foreground,
  },
});

