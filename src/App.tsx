import type { CSSProperties } from 'react';
import type { WidgetConfig } from './config';
import { Widget, type WidgetBridge } from './components/Widget';
import { CartProvider } from './state/cart';

export function App({ config, bridge }: { config: WidgetConfig; bridge: WidgetBridge }) {
  return (
    <div
      className="sa-root"
      data-theme={config.theme}
      data-position={config.position}
      style={{ '--sa-primary': config.primaryColor } as CSSProperties}
    >
      <CartProvider>
        <Widget config={config} bridge={bridge} />
      </CartProvider>
    </div>
  );
}
