import React from "react";
import { Platform } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CreateScreen from "../screens/CreateScreen";
import LibraryScreen from "../screens/LibraryScreen";
import { colors } from "../theme/colors";

export type RootTabParamList = {
  Create: { draftSk?: string } | undefined;
  Library: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function RootTabs() {
  const insets = useSafeAreaInsets();
  /** Tighter than full home-indicator inset so icons sit closer to the screen bottom. */
  const tabBarBottomInset =
    Platform.OS === "ios"
      ? Math.max(4, Math.round(insets.bottom * 0.35))
      : Math.max(0, insets.bottom);

  return (
    <Tab.Navigator
      safeAreaInsets={{ bottom: tabBarBottomInset }}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingTop: 2,
          paddingBottom: 0,
        },
        tabBarItemStyle: {
          paddingVertical: 0,
          marginVertical: 0,
        },
        tabBarIconStyle: {
          marginBottom: 0,
        },
      }}
    >
      <Tab.Screen
        name="Create"
        component={CreateScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="library-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
