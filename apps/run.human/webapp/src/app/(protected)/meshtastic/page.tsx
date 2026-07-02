import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/config/auth';

export const metadata: Metadata = {
  title: 'Meshtastic',
  description:
    'Flash a radio and join the DEF CON 34 Meshtastic network, or explore the live MQTT mesh.',
};

const tiles = [
  {
    href: 'https://flash.defcon.run',
    kicker: 'This',
    title: 'Flash & Join',
    body: 'Flash your Heltec / ESP32 radio in the browser and join the DEF CON 34 Meshtastic network.',
    cta: 'flash.defcon.run',
    art: <BoardArt />,
  },
  {
    href: 'https://mqtt.defcon.run',
    kicker: 'or That',
    title: 'Network',
    body: 'Bots and realtime visualization of the participants on the MQTT mesh — see the network come alive.',
    cta: 'mqtt.defcon.run',
    art: <MeshArt />,
  },
];

export default async function MeshtasticPage() {
  // Require login — send unauthenticated visitors to the home/sign-in page.
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  return (
    <div className="flex flex-col items-center gap-8 py-12 animate-slide-up">
      <div className="text-center space-y-3">
        <h1 className="font-museo text-3xl font-bold text-foreground">
          Meshtastic<span className="teal-dot">.</span>
        </h1>
        <p className="text-sm text-default-500 max-w-md">
          Two ways in. Flash a radio and join the mesh, or watch the network in
          realtime.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-2xl">
        {tiles.map((t) => (
          <a
            key={t.href}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className="glass-card group rounded-2xl p-6 flex flex-col items-center text-center gap-4 transition-transform duration-200 hover:-translate-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-primary">
              {t.kicker}
            </span>
            <div className="text-primary transition-transform duration-200 group-hover:scale-105">
              {t.art}
            </div>
            <h2 className="font-museo text-xl font-bold text-foreground">
              {t.title}
            </h2>
            <p className="text-sm text-default-500 leading-relaxed">{t.body}</p>
            <span className="mt-auto pt-2 font-mono text-xs text-default-400 group-hover:text-primary transition-colors">
              {t.cta} →
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/* Heltec / ESP32 dev board with antenna */
function BoardArt() {
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-hidden="true">
      <rect x="20" y="24" width="40" height="52" rx="4" stroke="currentColor" strokeWidth="2" />
      <rect x="28" y="34" width="24" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <line x1="24" y1="60" x2="56" y2="60" stroke="currentColor" strokeWidth="2" />
      <line x1="24" y1="66" x2="56" y2="66" stroke="currentColor" strokeWidth="2" />
      {[24, 32, 40, 48, 56].map((x) => (
        <line key={x} x1={x} y1="76" x2={x} y2="82" stroke="currentColor" strokeWidth="2" />
      ))}
      <path d="M60 24 L72 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="72" cy="12" r="3.5" fill="currentColor" />
    </svg>
  );
}

/* Mesh network of connected nodes */
function MeshArt() {
  const nodes = [
    [44, 16],
    [18, 40],
    [70, 40],
    [30, 70],
    [58, 70],
  ] as const;
  const edges = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 4],
    [3, 4],
    [1, 2],
  ] as const;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-hidden="true">
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]}
          y1={nodes[a][1]}
          x2={nodes[b][0]}
          y2={nodes[b][1]}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeOpacity="0.5"
        />
      ))}
      {nodes.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={i === 0 ? 6 : 4.5} fill="currentColor" />
      ))}
    </svg>
  );
}
