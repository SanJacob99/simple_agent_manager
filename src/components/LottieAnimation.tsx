import Lottie from 'lottie-react';

interface LottieAnimationProps {
  animationData: object;
  size?: number | string;
  width?: number | string;
  height?: number | string;
  loop?: boolean;
  autoplay?: boolean;
  className?: string;
}

export default function LottieAnimation({
  animationData,
  size,
  width,
  height,
  loop = true,
  autoplay = true,
  className,
}: LottieAnimationProps) {
  const resolvedWidth = size ?? width ?? '100%';
  const resolvedHeight = size ?? height ?? '100%';

  return (
    <Lottie
      animationData={animationData}
      loop={loop}
      autoplay={autoplay}
      className={className}
      style={{ width: resolvedWidth, height: resolvedHeight }}
    />
  );
}
