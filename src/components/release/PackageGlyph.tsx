import React from 'react';
import type { ReleasePackage } from '@/types';

/** 发布包内字形渲染：直接读取快照中的路径，绝不引用当前可编辑数据 */
export const PackageGlyph: React.FC<{
  pkg: ReleasePackage;
  radicalId: string;
  stageId?: string | null;
  size?: number;
  strokeColor?: string;
  strokeWidth?: number;
  className?: string;
}> = ({ pkg, radicalId, stageId = null, size = 96, strokeColor = '#3E2723', strokeWidth = 2.5, className = '' }) => {
  const entry = pkg.manifest.entries.find((e) => e.radicalId === radicalId);
  let svgPath = '';
  if (entry) {
    svgPath = (stageId && entry.stageGlyphs[stageId]) || entry.baseShape;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
      <g>
        {svgPath
          .split(/(?=M)/)
          .filter((s) => s.trim())
          .map((segment, idx) => (
            <path
              key={idx}
              d={segment}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 1px 1px rgba(62,39,35,0.1))' }}
            />
          ))}
      </g>
    </svg>
  );
};
