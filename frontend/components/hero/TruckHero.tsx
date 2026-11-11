'use client';

import React, { useRef, useEffect, useState } from 'react';

export default function TruckHero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSupported, setCanvasSupported] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCanvasSupported(false);
      return;
    }

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

    let animationFrameId: number;

    let time = 0;
    let truckX = -200; // Drive in from left
    const targetX = canvas.width / 2 - 120;

    const render = () => {
      time += 0.03;
      if (truckX < targetX) {
        truckX += (targetX - truckX) * 0.05 + 1;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const groundY = 220;

      // Draw road hairline
      ctx.strokeStyle = '#E3E1DC';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(canvas.width, groundY);
      ctx.stroke();

      // Gold line trailing behind truck
      ctx.strokeStyle = '#B08D3C';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY - 2);
      ctx.lineTo(truckX + 20, groundY - 2);
      ctx.stroke();

      // Subtle road dash markings moving left
      ctx.strokeStyle = '#E3E1DC';
      ctx.lineWidth = 1;
      ctx.setLineDash([15, 20]);
      ctx.lineDashOffset = -time * 60;
      ctx.beginPath();
      ctx.moveTo(0, groundY + 15);
      ctx.lineTo(canvas.width, groundY + 15);
      ctx.stroke();
      ctx.setLineDash([]); // reset

      // Soft ground shadow under truck
      const bob = Math.sin(time * 3) * 1.5;
      const truckY = groundY - 75 + bob;

      ctx.fillStyle = 'rgba(20, 23, 28, 0.06)';
      ctx.beginPath();
      ctx.ellipse(truckX + 130, groundY - 2, 135, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // TRUCK CHASSIS & BODY
      // 1. Refrigerated Cargo Box (Ivory)
      ctx.fillStyle = '#F7F6F3';
      ctx.strokeStyle = '#E3E1DC';
      ctx.lineWidth = 1;
      ctx.fillRect(truckX, truckY, 170, 70);
      ctx.strokeRect(truckX, truckY, 170, 70);

      // Gold accent stripe across refrigerated box
      ctx.fillStyle = '#B08D3C';
      ctx.fillRect(truckX, truckY + 45, 170, 3);

      // Reefer unit on front of box
      ctx.fillStyle = '#E3E1DC';
      ctx.fillRect(truckX + 160, truckY + 8, 12, 28);

      // 2. Cab (White/Paper)
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(truckX + 170, truckY + 22);
      ctx.lineTo(truckX + 215, truckY + 22);
      ctx.lineTo(truckX + 235, truckY + 45);
      ctx.lineTo(truckX + 235, truckY + 70);
      ctx.lineTo(truckX + 170, truckY + 70);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cab Windshield
      ctx.fillStyle = '#14171C';
      ctx.beginPath();
      ctx.moveTo(truckX + 200, truckY + 26);
      ctx.lineTo(truckX + 214, truckY + 26);
      ctx.lineTo(truckX + 228, truckY + 44);
      ctx.lineTo(truckX + 200, truckY + 44);
      ctx.closePath();
      ctx.fill();

      // Cab Door Window
      ctx.fillStyle = '#5B6470';
      ctx.fillRect(truckX + 176, truckY + 26, 20, 18);

      // Headlight
      ctx.fillStyle = '#B08D3C';
      ctx.fillRect(truckX + 233, truckY + 54, 3, 6);

      // Wheels (Matte slate / dark ink tires)
      const wheelPositions = [truckX + 35, truckX + 75, truckX + 205];
      wheelPositions.forEach((wx) => {
        // Outer tire
        ctx.fillStyle = '#14171C';
        ctx.beginPath();
        ctx.arc(wx, groundY - 6, 12, 0, Math.PI * 2);
        ctx.fill();

        // Inner rim
        ctx.fillStyle = '#E3E1DC';
        ctx.beginPath();
        ctx.arc(wx, groundY - 6, 5, 0, Math.PI * 2);
        ctx.fill();

        // Wheel rotation spoke indicator
        ctx.strokeStyle = '#5B6470';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const spokeAngle = time * 8;
        ctx.moveTo(wx, groundY - 6);
        ctx.lineTo(wx + Math.cos(spokeAngle) * 5, groundY - 6 + Math.sin(spokeAngle) * 5);
        ctx.stroke();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="w-full relative flex flex-col items-center justify-center my-6">
      <canvas
        ref={canvasRef}
        width={800}
        height={260}
        className="w-full max-w-4xl h-auto block"
      />
      {!canvasSupported && (
        <div className="text-slate text-sm">
          [Canvas display unavailable — static view active]
        </div>
      )}
    </div>
  );
}
