const Privacy = () => (
  <div className="max-w-3xl mx-auto p-8 prose prose-sm">
    <h1 className="text-3xl font-bold mb-6">プライバシーポリシー</h1>
    <p className="text-sm text-muted-foreground mb-6">最終更新: 2026年5月1日</p>

    <section className="space-y-4 text-sm leading-relaxed">
      <h2 className="text-xl font-semibold mt-6">1. 取得する情報</h2>
      <ul className="list-disc pl-5">
        <li>氏名、メールアドレス、電話番号、サロン名等の登録情報</li>
        <li>お客様（エンドユーザー）情報、予約履歴、メッセージ送受信履歴</li>
        <li>サービス利用ログ、IPアドレス、デバイス情報</li>
      </ul>

      <h2 className="text-xl font-semibold mt-6">2. 利用目的</h2>
      <ul className="list-disc pl-5">
        <li>本サービスの提供および運営</li>
        <li>料金の請求および収納</li>
        <li>サービス改善のための分析</li>
        <li>重要なお知らせの送信</li>
      </ul>

      <h2 className="text-xl font-semibold mt-6">3. 第三者提供</h2>
      <p>法令に基づく場合を除き、ユーザーの同意なく個人情報を第三者に提供しません。</p>

      <h2 className="text-xl font-semibold mt-6">4. 業務委託</h2>
      <p>サーバー運用、決済処理等の業務をStripe、Supabase（Lovable Cloud）等の信頼できる事業者に委託します。</p>

      <h2 className="text-xl font-semibold mt-6">5. 安全管理</h2>
      <p>個人情報への不正アクセス、紛失、破壊、改ざん、漏えい等を防止するため、適切な安全管理措置を講じます。</p>

      <h2 className="text-xl font-semibold mt-6">6. 開示・訂正・削除</h2>
      <p>ユーザーご本人からの請求により、保有する個人情報の開示・訂正・削除に応じます。</p>

      <h2 className="text-xl font-semibold mt-6">7. お問い合わせ</h2>
      <p>本ポリシーに関するお問い合わせは support@saronboost.com までご連絡ください。</p>
    </section>
  </div>
);
export default Privacy;
