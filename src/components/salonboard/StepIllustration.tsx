// SVG illustrations for SalonBoard guide. Brand: gold (#b08e4f), ink (#1a1a1a), cream (#fafaf7)
// All illustrations are pure SVG — no external assets, instantly rendered, perfectly on-brand.

type Props = { className?: string };

const stroke = "#1a1a1a";
const gold = "#b08e4f";
const cream = "#fafaf7";

// ① ZIP ダウンロード
export const StepDownload = ({ className }: Props) => (
  <svg viewBox="0 0 320 200" className={className} fill="none">
    <rect x="0" y="0" width="320" height="200" fill={cream} />
    {/* cloud */}
    <path d="M90 70c-14 0-26 10-26 24s12 24 26 24h140c18 0 32-14 32-32s-14-32-32-32c-3-14-15-24-30-24-12 0-22 7-27 17-3-1-7-2-11-2-15 0-26 11-26 25z" fill="#fff" stroke={stroke} strokeWidth="1.5"/>
    {/* download arrow */}
    <line x1="160" y1="105" x2="160" y2="155" stroke={gold} strokeWidth="3" strokeLinecap="round"/>
    <path d="M145 142 L160 158 L175 142" stroke={gold} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    {/* zip box */}
    <rect x="135" y="160" width="50" height="30" fill={stroke}/>
    <text x="160" y="180" textAnchor="middle" fill={cream} fontSize="11" fontFamily="monospace" letterSpacing="1">ZIP</text>
  </svg>
);

// ② Chrome extensions ページ + デベロッパーモードON
export const StepDevMode = ({ className }: Props) => (
  <svg viewBox="0 0 320 200" className={className} fill="none">
    <rect x="0" y="0" width="320" height="200" fill={cream}/>
    {/* browser frame */}
    <rect x="20" y="20" width="280" height="160" fill="#fff" stroke={stroke} strokeWidth="1.5"/>
    <rect x="20" y="20" width="280" height="22" fill="#f0ece4" stroke={stroke} strokeWidth="1.5"/>
    <circle cx="32" cy="31" r="3" fill="#c4554d"/><circle cx="44" cy="31" r="3" fill="#e0b84a"/><circle cx="56" cy="31" r="3" fill="#5fb86b"/>
    {/* address bar */}
    <rect x="80" y="26" width="200" height="12" fill={cream} stroke="#d4cfc4"/>
    <text x="86" y="35" fill={stroke} fontSize="8" fontFamily="monospace">chrome://extensions</text>
    {/* toggle */}
    <text x="160" y="90" textAnchor="middle" fill={stroke} fontSize="11" fontFamily="serif">デベロッパーモード</text>
    <rect x="135" y="100" width="50" height="22" rx="11" fill={gold}/>
    <circle cx="172" cy="111" r="8" fill="#fff"/>
    {/* arrow */}
    <path d="M220 111 L195 111" stroke={gold} strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M203 105 L195 111 L203 117" stroke={gold} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <text x="225" y="115" fill={gold} fontSize="10" fontFamily="serif">ON</text>
  </svg>
);

// ③ フォルダ読み込み
export const StepLoadUnpacked = ({ className }: Props) => (
  <svg viewBox="0 0 320 200" className={className} fill="none">
    <rect x="0" y="0" width="320" height="200" fill={cream}/>
    {/* button */}
    <rect x="40" y="80" width="170" height="40" fill={stroke}/>
    <text x="125" y="105" textAnchor="middle" fill={cream} fontSize="11" fontFamily="serif" letterSpacing="1">パッケージ化されていない</text>
    <text x="125" y="118" textAnchor="middle" fill={cream} fontSize="11" fontFamily="serif" letterSpacing="1">拡張機能を読み込む</text>
    {/* arrow */}
    <path d="M225 100 L255 100" stroke={gold} strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M247 92 L255 100 L247 108" stroke={gold} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    {/* folder */}
    <path d="M260 80 L275 80 L280 86 L300 86 L300 120 L260 120 Z" fill={gold} stroke={stroke} strokeWidth="1.5"/>
    <line x1="260" y1="92" x2="300" y2="92" stroke={stroke} strokeWidth="1"/>
    {/* click cursor */}
    <path d="M180 130 L180 160 L188 153 L194 167 L200 165 L194 151 L205 151 Z" fill={cream} stroke={stroke} strokeWidth="1.5"/>
  </svg>
);

// ④ サロンボードへ送信
export const StepScan = ({ className }: Props) => (
  <svg viewBox="0 0 320 200" className={className} fill="none">
    <rect x="0" y="0" width="320" height="200" fill={cream}/>
    {/* extension popup */}
    <rect x="30" y="30" width="120" height="140" fill="#fff" stroke={stroke} strokeWidth="1.5"/>
    <text x="90" y="50" textAnchor="middle" fill={stroke} fontSize="10" fontFamily="serif" fontWeight="bold">Salon Boost</text>
    <line x1="40" y1="58" x2="140" y2="58" stroke="#e5e2da"/>
    <rect x="42" y="68" width="96" height="14" fill={cream} stroke="#d4cfc4"/>
    <rect x="42" y="88" width="96" height="14" fill={cream} stroke="#d4cfc4"/>
    <rect x="42" y="115" width="96" height="22" fill={stroke}/>
    <text x="90" y="129" textAnchor="middle" fill={cream} fontSize="9" fontFamily="serif" letterSpacing="1">送信</text>
    {/* arrow flow */}
    <path d="M165 100 L210 100" stroke={gold} strokeWidth="2.5" strokeDasharray="4 3"/>
    <path d="M202 92 L210 100 L202 108" stroke={gold} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    {/* server / database */}
    <ellipse cx="260" cy="75" rx="30" ry="8" fill={gold} stroke={stroke} strokeWidth="1.5"/>
    <path d="M230 75 L230 125" stroke={stroke} strokeWidth="1.5"/>
    <path d="M290 75 L290 125" stroke={stroke} strokeWidth="1.5"/>
    <path d="M230 125 Q260 135 290 125" fill={gold} stroke={stroke} strokeWidth="1.5"/>
    <ellipse cx="260" cy="95" rx="30" ry="8" fill="none" stroke={stroke} strokeWidth="1" opacity="0.5"/>
    <ellipse cx="260" cy="115" rx="30" ry="8" fill="none" stroke={stroke} strokeWidth="1" opacity="0.5"/>
    <text x="260" y="160" textAnchor="middle" fill={stroke} fontSize="10" fontFamily="serif">Salon Boost</text>
  </svg>
);

// Hero animation: animated flow diagram
export const HeroFlow = ({ className }: Props) => (
  <svg viewBox="0 0 800 220" className={className} fill="none">
    <style>{`
      @keyframes pulse-1 { 0%,100% {opacity:.3} 20%,40% {opacity:1} }
      @keyframes pulse-2 { 0%,100% {opacity:.3} 30%,50% {opacity:1} }
      @keyframes pulse-3 { 0%,100% {opacity:.3} 50%,70% {opacity:1} }
      @keyframes pulse-4 { 0%,100% {opacity:.3} 70%,90% {opacity:1} }
      @keyframes flow { 0% {stroke-dashoffset:40} 100% {stroke-dashoffset:0} }
      .pulse-1 { animation: pulse-1 4s ease-in-out infinite; }
      .pulse-2 { animation: pulse-2 4s ease-in-out infinite; }
      .pulse-3 { animation: pulse-3 4s ease-in-out infinite; }
      .pulse-4 { animation: pulse-4 4s ease-in-out infinite; }
      .flow-line { stroke-dasharray: 6 4; animation: flow 1.5s linear infinite; }
    `}</style>
    {/* connecting lines */}
    <line x1="120" y1="100" x2="280" y2="100" stroke={gold} strokeWidth="1.5" className="flow-line"/>
    <line x1="320" y1="100" x2="480" y2="100" stroke={gold} strokeWidth="1.5" className="flow-line"/>
    <line x1="520" y1="100" x2="680" y2="100" stroke={gold} strokeWidth="1.5" className="flow-line"/>

    {/* node 1: Download */}
    <g className="pulse-1">
      <circle cx="80" cy="100" r="40" fill={cream} stroke={stroke} strokeWidth="1.5"/>
      <path d="M80 80 L80 110 M70 100 L80 110 L90 100" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <rect x="68" y="115" width="24" height="6" fill={stroke}/>
      <text x="80" y="170" textAnchor="middle" fill={stroke} fontSize="11" fontFamily="serif">DL</text>
    </g>
    {/* node 2: Install */}
    <g className="pulse-2">
      <circle cx="300" cy="100" r="40" fill={cream} stroke={stroke} strokeWidth="1.5"/>
      <rect x="282" y="85" width="36" height="26" fill="none" stroke={stroke} strokeWidth="1.5"/>
      <rect x="282" y="85" width="36" height="6" fill={gold}/>
      <text x="300" y="170" textAnchor="middle" fill={stroke} fontSize="11" fontFamily="serif">Install</text>
    </g>
    {/* node 3: Scan */}
    <g className="pulse-3">
      <circle cx="500" cy="100" r="40" fill={cream} stroke={stroke} strokeWidth="1.5"/>
      <circle cx="500" cy="100" r="14" fill="none" stroke={stroke} strokeWidth="1.5"/>
      <line x1="510" y1="110" x2="518" y2="118" stroke={stroke} strokeWidth="2" strokeLinecap="round"/>
      <text x="500" y="170" textAnchor="middle" fill={stroke} fontSize="11" fontFamily="serif">Scan</text>
    </g>
    {/* node 4: Done */}
    <g className="pulse-4">
      <circle cx="720" cy="100" r="40" fill={gold} stroke={stroke} strokeWidth="1.5"/>
      <path d="M704 100 L716 112 L738 88" stroke={cream} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <text x="720" y="170" textAnchor="middle" fill={stroke} fontSize="11" fontFamily="serif">Done</text>
    </g>
  </svg>
);
