import React, { useEffect, useState } from 'react';

interface TileProps {
  imagePath: string;
  style: React.CSSProperties;
  className?: string;
}

interface BlurPulseBackgroundProps {
  imagePath: string;
  className?: string;
  tileCount?: number;
}

const BackgroundTile: React.FC<TileProps> = ({ imagePath, style, className = '' }) => {
  return (
    <div
      className={`absolute z-0 animate-blurPulse ${className}`}
      style={{
        backgroundImage: `url('${imagePath}')`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  );
};

export const BlurPulseBackground: React.FC<BlurPulseBackgroundProps> = ({ 
  imagePath, 
  className = '',
  tileCount = 3 // Increased from 12 to 30
}) => {
  const [tiles, setTiles] = useState<React.ReactNode[]>([]);
  
  useEffect(() => {
    const newTiles = [];
    
    // Calculate grid dimensions based on tile count
    const gridSize = Math.ceil(Math.sqrt(tileCount));
    
    // Create a distribution that concentrates in the middle and spreads outward
    const createCenteredDistribution = () => {
      const tiles = [];
      
      // First place a tile in the center
      tiles.push({
        x: 0.5, // Center X (50%)
        y: 0.5, // Center Y (50%)
        size: 0.3 + (Math.random() * 0.1) // Larger size for center tile (30-40%)
      });
      
      // Then place the remaining tiles in concentric rings
      const remainingTiles = tileCount - 1;
      if (remainingTiles > 0) {
        // Calculate number of rings needed
        const ringsNeeded = Math.ceil(Math.log2(remainingTiles + 1));
        let tilesPlaced = 1;
        
        for (let ring = 1; ring <= ringsNeeded && tilesPlaced < tileCount; ring++) {
          // Distance from center increases with each ring
          const distance = ring * (0.4 / ringsNeeded);
          
          // Number of tiles in this ring (more tiles in outer rings)
          const tilesInRing = Math.min(ring * 4, remainingTiles - (tilesPlaced - 1));
          
          for (let i = 0; i < tilesInRing && tilesPlaced < tileCount; i++) {
            // Calculate position around the ring
            const angle = (i / tilesInRing) * Math.PI * 2;
            const x = 0.5 + Math.cos(angle) * distance;
            const y = 0.5 + Math.sin(angle) * distance;
            
            // Size decreases as we move outward
            const sizeScale = 1 - (ring / (ringsNeeded * 1.5));
            const size = (0.15 + (Math.random() * 0.1)) * sizeScale;
            
            tiles.push({ x, y, size });
            tilesPlaced++;
          }
        }
      }
      
      return tiles;
    };
    
    const tilePositions = createCenteredDistribution();
    
    for (let i = 0; i < tilePositions.length; i++) {
      const { x, y, size } = tilePositions[i];
      
      // Convert normalized positions (0-1) to percentages (0-100%)
      const left = x * 100 - (size * 100 / 2);
      const top = y * 100 - (size * 100 / 2);
      
      const opacity = Math.random() * 0.1 + 0.8; // 0.8 to 0.9 opacity
      const rotationDeg = Math.floor(Math.random() * 50) - 25; // -25 to +25 degrees rotation
      const animationDelay = Math.random() * -10; // Staggered animation
      
      const tileStyle: React.CSSProperties = {
        width: `${size * 100}%`,
        height: `${size * 100}%`,
        left: `${left}%`,
        top: `${top}%`,
        opacity,
        transform: `rotate(${rotationDeg}deg)`,
        animationDelay: `${animationDelay}s`,
      };
      
      newTiles.push(
        <BackgroundTile 
          key={i}
          imagePath={imagePath}
          style={tileStyle}
          className={className}
        />
      );
    }
    
    setTiles(newTiles);
  }, [imagePath, className, tileCount]);
  
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {tiles}
    </div>
  );
};

export default BlurPulseBackground;