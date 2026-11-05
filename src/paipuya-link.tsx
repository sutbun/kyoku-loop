export function PaipuyaLink() {
  return (
    <a
      href={import.meta.env.VITE_KYOKULOOP_PAIPUYA_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      牌譜屋を開く
    </a>
  );
}
