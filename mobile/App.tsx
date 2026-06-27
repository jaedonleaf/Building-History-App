import { useCallback, useEffect, useState } from "react";
import * as ExpoSplashScreen from "expo-splash-screen";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

void ExpoSplashScreen.preventAutoHideAsync();

const NAVY = "#08294A";
const GOLD = "#C9972B";
const BLUE = "#7BA7D7";
const WHITE = "#F8F6EF";
const PIN_PATH_LENGTH = 900;
const YEARS = ["1800", "1850", "1900", "1950", "Present"];

const AnimatedPath = Animated.createAnimatedComponent(Path);

function HistrSplash({ onFinished }: { onFinished: () => void }) {
  const drawProgress = useSharedValue(0);
  const timelineOffset = useSharedValue(0);
  const wordOpacity = useSharedValue(0);
  const exitOpacity = useSharedValue(1);
  const exitScale = useSharedValue(1);

  useEffect(() => {
    drawProgress.value = withTiming(1, {
      duration: 800,
      easing: Easing.out(Easing.cubic),
    });
    timelineOffset.value = withTiming(-380, {
      duration: 1800,
      easing: Easing.out(Easing.cubic),
    });
    wordOpacity.value = withDelay(850, withTiming(1, { duration: 420 }));
    exitOpacity.value = withDelay(
      2000,
      withTiming(0, { duration: 360 }, (finished) => {
        if (finished) runOnJS(onFinished)();
      }),
    );
    exitScale.value = withDelay(2000, withTiming(1.04, { duration: 360 }));
  }, [drawProgress, exitOpacity, exitScale, onFinished, timelineOffset, wordOpacity]);

  const splashStyle = useAnimatedStyle(() => ({
    opacity: exitOpacity.value,
    transform: [{ scale: exitScale.value }],
  }));

  const timelineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: timelineOffset.value }],
  }));

  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
  }));

  const pinAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: PIN_PATH_LENGTH * (1 - drawProgress.value),
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.splash, splashStyle]}>
      <View style={styles.timelineLayer}>
        <Animated.View style={[styles.timelineTrack, timelineStyle]}>
          {YEARS.map((year) => (
            <View key={year} style={styles.timelineItem}>
              <Text style={styles.timelineYear}>{year}</Text>
              <View style={styles.timelineLine}>
                <View style={styles.timelineDot} />
              </View>
            </View>
          ))}
        </Animated.View>
      </View>

      <View style={styles.brandMark}>
        <Svg width={260} height={260} viewBox="90 20 260 310">
          <AnimatedPath
            d="M220 40 C150 40 120 100 120 150 C120 220 220 300 220 300 C220 300 320 220 320 150 C320 100 290 40 220 40"
            stroke={BLUE}
            fill="none"
            strokeLinecap="round"
            strokeWidth={10}
            strokeDasharray={PIN_PATH_LENGTH}
            animatedProps={pinAnimatedProps}
          />
          <AnimatedPath
            d="M220 60 C165 60 140 108 140 150 C140 205 220 280 220 280 C220 280 300 205 300 150 C300 108 275 60 220 60"
            stroke={GOLD}
            fill="none"
            strokeLinecap="round"
            strokeWidth={10}
            strokeDasharray={PIN_PATH_LENGTH}
            animatedProps={pinAnimatedProps}
          />
          <AnimatedPath
            d="M220 90 C185 90 170 122 170 150 C170 185 220 245 220 245 C220 245 270 185 270 150 C270 122 255 90 220 90"
            stroke={WHITE}
            fill="none"
            strokeLinecap="round"
            strokeWidth={10}
            strokeDasharray={PIN_PATH_LENGTH}
            animatedProps={pinAnimatedProps}
          />
        </Svg>
        <Animated.Text style={[styles.wordmark, wordStyle]}>
          histr
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

function HomeScreen() {
  return (
    <View style={styles.home}>
      <Text style={styles.homeEyebrow}>Histr</Text>
      <Text style={styles.homeTitle}>Explore building history nearby.</Text>
    </View>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  const hideNativeSplash = useCallback(async () => {
    await ExpoSplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    void hideNativeSplash();
  }, [hideNativeSplash]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <HomeScreen />
      {showSplash ? <HistrSplash onFinished={() => setShowSplash(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: NAVY,
  },
  splash: {
    alignItems: "center",
    backgroundColor: NAVY,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  timelineLayer: {
    left: 0,
    opacity: 0.48,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: "46%",
  },
  timelineTrack: {
    alignItems: "center",
    flexDirection: "row",
    width: 740,
  },
  timelineItem: {
    width: 148,
  },
  timelineYear: {
    color: WHITE,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 8,
    textAlign: "center",
  },
  timelineLine: {
    alignItems: "center",
    borderTopColor: WHITE,
    borderTopWidth: 2,
    justifyContent: "center",
  },
  timelineDot: {
    backgroundColor: GOLD,
    borderRadius: 5,
    height: 10,
    marginTop: -6,
    width: 10,
  },
  brandMark: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  wordmark: {
    color: WHITE,
    fontSize: 72,
    fontWeight: "800",
    lineHeight: 82,
    marginTop: -8,
  },
  home: {
    flex: 1,
    backgroundColor: NAVY,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  homeEyebrow: {
    color: GOLD,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  homeTitle: {
    color: WHITE,
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 40,
  },
});
