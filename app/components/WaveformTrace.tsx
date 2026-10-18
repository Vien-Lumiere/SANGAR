import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Dimensions, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useApp } from '../context/AppContext';
import { theme } from '../config/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const HEIGHT = 140;
const CENTER_Y = HEIGHT / 2;
const NUM_POINTS = 80;
const STEP_X = SCREEN_WIDTH / (NUM_POINTS - 1);

export const WaveformTrace: React.FC = () => {
  const { isAlarmActive } = useApp();
  const [pathData, setPathData] = useState('');
  const pointsRef = useRef<number[]>(Array(NUM_POINTS).fill(CENTER_Y));
  const animationFrameIdRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    let lastTime = Date.now();
    
    const updateWave = () => {
      const now = Date.now();
      const delta = now - lastTime;
      
      // Update at roughly ~30fps (33ms) to ensure smooth rendering without overloading CPU
      if (delta >= 30) {
        lastTime = now;
        phaseRef.current += 0.2;

        const points = [...pointsRef.current];
        points.shift(); // Remove the oldest point

        let nextValue = CENTER_Y;
        if (isAlarmActive) {
          // Alert state: High amplitude chaotic spikes (similar to a seismograph peak)
          // Mix sine waves with high-contrast random impulses
          const baseOsc = Math.sin(phaseRef.current * 1.5) * 20;
          const randomSpike = Math.random() > 0.4 ? (Math.random() - 0.5) * 80 : 0;
          nextValue = CENTER_Y + baseOsc + randomSpike;
          
          // Clamp value within bounds of SVG height (leave margin)
          nextValue = Math.max(10, Math.min(HEIGHT - 10, nextValue));
        } else {
          // Normal state: Calm standby mode with tiny high-frequency micro-oscillations
          const baseNoise = Math.sin(phaseRef.current * 0.8) * 1.5;
          const microJitter = (Math.random() - 0.5) * 1.2;
          nextValue = CENTER_Y + baseNoise + microJitter;
        }

        points.push(nextValue); // Add the newest point
        pointsRef.current = points;

        // Build SVG path: "M x0 y0 L x1 y1 L x2 y2 ..."
        let newPath = `M 0 ${points[0]}`;
        for (let i = 1; i < NUM_POINTS; i++) {
          newPath += ` L ${i * STEP_X} ${points[i]}`;
        }
        setPathData(newPath);
      }
      
      animationFrameIdRef.current = requestAnimationFrame(updateWave);
    };

    animationFrameIdRef.current = requestAnimationFrame(updateWave);

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [isAlarmActive]);

  const activeColor = isAlarmActive ? theme.colors.accentAlert : theme.colors.accentCalm;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {isAlarmActive ? '⚠ VIBRASI SEISMIK ANOMALI' : '✦ SENSOR STANDBY / MONITORING AKTIF'}
      </Text>
      <View style={styles.waveContainer}>
        {/* Background Grid Lines to evoke technical instruments */}
        <View style={styles.gridLine} />
        <View style={[styles.gridLine, { top: CENTER_Y }]} />
        <View style={[styles.gridLine, { top: HEIGHT - 1 }]} />
        
        <Svg width={SCREEN_WIDTH} height={HEIGHT} style={styles.svg}>
          <Path
            d={pathData}
            fill="none"
            stroke={activeColor}
            strokeWidth={isAlarmActive ? 2 : 1.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      </View>
      <View style={styles.legendContainer}>
        <Text style={styles.legendText}>RANGE: ±1.5G</Text>
        <Text style={styles.legendText}>FREQ: 100HZ</Text>
        <Text style={styles.legendText}>SANGAR ANALOG CH-1</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.bgBase,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#2C323D',
  },
  label: {
    fontFamily: theme.fonts.heading,
    fontSize: 10,
    letterSpacing: 1.2,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
  },
  waveContainer: {
    height: HEIGHT,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#282F3B',
    opacity: 0.5,
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  legendText: {
    fontFamily: theme.fonts.mono,
    fontSize: 9,
    color: theme.colors.textSecondary,
  },
});
