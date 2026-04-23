import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { fonts } from "../theme/fonts";

const pillars = [
  {
    title: "Goals & intentions over time",
    body: "Capture what you want and how it shifts—so your direction stays visible, not lost in notes.",
  },
  {
    title: "A plan you can use",
    body: "Break aims into steps and check-ins. Consciously will help you refine and adjust when life changes.",
  },
  {
    title: "Meditation from your plan",
    body: "Later, goals and language here will feed manifestation- and visualization-style meditations on mobile and web.",
  },
] as const;

export default function PlanScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>Plan</Text>
        <Text style={styles.title}>From intention to action</Text>
        <Text style={styles.subtitle}>
          Track goals and intentions, shape a plan, and—soon—connect it to guided
          meditations built around your own words.
        </Text>
        <Text style={styles.note}>
          This space is early: full goal tracking and meditation hand-off will roll
          out after journal and create flows mature. You are in the right place for
          where it will live.
        </Text>
        {pillars.map((p) => (
          <View key={p.title} style={styles.card}>
            <Text style={styles.cardTitle}>{p.title}</Text>
            <Text style={styles.cardBody}>{p.body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 8,
  },
  kicker: {
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.accent,
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontFamily: fonts.displaySemiBold,
    color: colors.foreground,
    letterSpacing: -0.3,
    lineHeight: 32,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.muted,
    lineHeight: 24,
    marginBottom: 16,
  },
  note: {
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.muted,
    lineHeight: 21,
    marginBottom: 22,
    opacity: 0.95,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: fonts.displayMedium,
    color: colors.foreground,
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.muted,
    lineHeight: 21,
  },
});
