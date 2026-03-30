import { StatusBar } from "expo-status-bar";
import CreateScreen from "./src/screens/CreateScreen";

export default function App() {
  return (
    <>
      <CreateScreen />
      <StatusBar style="auto" />
    </>
  );
}
