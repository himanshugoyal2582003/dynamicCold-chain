'use client';

import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Float, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

function SentinelDeviceMesh() {
  const ledRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (ledRef.current) {
      ledRef.current.emissiveIntensity = 0.8 + Math.sin(clock.getElapsedTime() * 3.2) * 0.45;
    }
  });

  return (
    <Float speed={1.6} rotationIntensity={0.25} floatIntensity={0.35}>
      <group rotation={[0.18, -0.45, 0]}>
        {/* Main anodized charcoal chassis */}
        <RoundedBox args={[2.5, 1.55, 0.56]} radius={0.1} smoothness={4} castShadow receiveShadow>
          <meshStandardMaterial color="#1C2026" metalness={0.65} roughness={0.32} />
        </RoundedBox>

        {/* Brushed gold accent bezel */}
        <RoundedBox args={[2.54, 1.59, 0.14]} radius={0.08} smoothness={4} position={[0, 0, 0.12]}>
          <meshStandardMaterial color="#B08D3C" metalness={0.85} roughness={0.22} />
        </RoundedBox>

        {/* Front dark faceplate */}
        <RoundedBox args={[2.32, 1.38, 0.08]} radius={0.06} smoothness={4} position={[0, 0, 0.27]}>
          <meshStandardMaterial color="#14171C" metalness={0.4} roughness={0.45} />
        </RoundedBox>

        {/* OLED Telemetry Screen */}
        <RoundedBox args={[1.32, 0.72, 0.04]} radius={0.03} smoothness={3} position={[-0.32, 0.12, 0.31]}>
          <meshStandardMaterial
            color="#07131E"
            emissive="#0B2E3C"
            emissiveIntensity={0.65}
            roughness={0.15}
            metalness={0.2}
          />
        </RoundedBox>

        {/* Simulated OLED readout bars */}
        <mesh position={[-0.45, 0.22, 0.335]}>
          <boxGeometry args={[0.72, 0.12, 0.01]} />
          <meshStandardMaterial color="#34D399" emissive="#34D399" emissiveIntensity={1.1} />
        </mesh>
        <mesh position={[-0.32, 0.02, 0.335]}>
          <boxGeometry args={[0.96, 0.06, 0.01]} />
          <meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.85} />
        </mesh>
        <mesh position={[-0.48, -0.1, 0.335]}>
          <boxGeometry args={[0.62, 0.05, 0.01]} />
          <meshStandardMaterial color="#B08D3C" emissive="#B08D3C" emissiveIntensity={0.7} />
        </mesh>

        {/* Status LEDs */}
        <mesh position={[0.72, 0.34, 0.32]}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshStandardMaterial ref={ledRef} color="#34D399" emissive="#2E7D5B" emissiveIntensity={1.0} />
        </mesh>
        <mesh position={[0.72, 0.18, 0.32]}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshStandardMaterial color="#38BDF8" emissive="#0284C7" emissiveIntensity={0.9} />
        </mesh>
        <mesh position={[0.72, 0.02, 0.32]}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshStandardMaterial color="#B08D3C" emissive="#B08D3C" emissiveIntensity={0.6} />
        </mesh>

        {/* Mounting flanges left & right */}
        <RoundedBox args={[0.26, 0.9, 0.1]} radius={0.03} smoothness={3} position={[-1.34, 0, -0.18]}>
          <meshStandardMaterial color="#2A3039" metalness={0.75} roughness={0.35} />
        </RoundedBox>
        <RoundedBox args={[0.26, 0.9, 0.1]} radius={0.03} smoothness={3} position={[1.34, 0, -0.18]}>
          <meshStandardMaterial color="#2A3039" metalness={0.75} roughness={0.35} />
        </RoundedBox>

        {/* Top LoRa / LTE-M SMA Antenna */}
        <mesh position={[0.85, 0.85, 0]}>
          <cylinderGeometry args={[0.09, 0.11, 0.16, 20]} />
          <meshStandardMaterial color="#B08D3C" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0.85, 1.48, 0]}>
          <cylinderGeometry args={[0.045, 0.075, 1.15, 20]} />
          <meshStandardMaterial color="#14171C" metalness={0.35} roughness={0.45} />
        </mesh>

        {/* External PT1000 Stainless Probe Connector (bottom-left) */}
        <mesh position={[-0.75, -0.86, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.18, 20]} />
          <meshStandardMaterial color="#94A3B8" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[-0.75, -1.18, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.5, 16]} />
          <meshStandardMaterial color="#475569" metalness={0.4} roughness={0.5} />
        </mesh>
      </group>
    </Float>
  );
}

export default function IotDevice3D() {
  return (
    <div
      className="relative w-full h-[360px] rounded border overflow-hidden"
      style={{ background: '#F7F6F3', borderColor: 'var(--color-hairline)' }}
    >
      <Canvas shadows camera={{ position: [0, 0.4, 4.6], fov: 38 }} dpr={[1, 2]}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 6, 5]} intensity={1.35} castShadow />
        <pointLight position={[-4, -2, 3]} intensity={0.5} color="#B08D3C" />
        <SentinelDeviceMesh />
        <ContactShadows position={[0, -1.55, 0]} opacity={0.35} scale={7} blur={2.4} far={3} />
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={1.2} />
      </Canvas>
      <div
        className="pointer-events-none absolute bottom-3 left-3 px-2.5 py-1 rounded border text-[11px] font-medium"
        style={{
          background: 'rgba(255,255,255,0.9)',
          borderColor: 'var(--color-hairline)',
          color: 'var(--color-slate)',
        }}
      >
        Interactive 3D · Drag to rotate
      </div>
    </div>
  );
}
