const Terms = () => (
  <div className="max-w-3xl mx-auto p-8 prose prose-sm">
    <h1 className="text-3xl font-bold mb-6">利用規約</h1>
    <p className="text-sm text-muted-foreground mb-6">最終更新: 2026年5月1日</p>

    <section className="space-y-4 text-sm leading-relaxed">
      <h2 className="text-xl font-semibold mt-6">第1条（適用）</h2>
      <p>本規約は、Salon Boost（以下「本サービス」）の利用に関する一切の関係に適用されます。</p>

      <h2 className="text-xl font-semibold mt-6">第2条（利用登録）</h2>
      <p>登録希望者は、本規約に同意の上、所定の方法により利用登録を申請し、当社が承認した時点で登録が完了します。</p>

      <h2 className="text-xl font-semibold mt-6">第3条（料金）</h2>
      <ul className="list-disc pl-5">
        <li>初回登録から60日間は無料でご利用いただけます</li>
        <li>以降は月額¥9,800（税込）の課金が発生します</li>
        <li>支払いはクレジットカードによる自動引落としとなります</li>
      </ul>

      <h2 className="text-xl font-semibold mt-6">第4条（解約）</h2>
      <p>ユーザーはいつでも解約することができます。解約後も次回更新日まではご利用可能です。</p>

      <h2 className="text-xl font-semibold mt-6">第5条（禁止事項）</h2>
      <p>法令違反、当社や第三者の権利侵害、本サービスの運営妨害となる行為を禁止します。</p>

      <h2 className="text-xl font-semibold mt-6">第6条（免責）</h2>
      <p>当社は、本サービスに関して、その完全性・正確性・確実性等についていかなる保証も行いません。</p>

      <h2 className="text-xl font-semibold mt-6">第7条（サロンボード連携拡張機能の利用）</h2>
      <p>
        当社が提供するサロンボード（株式会社リクルートが運営するホットペッパービューティー店舗管理ツール）連携用ブラウザ拡張機能（以下「本拡張機能」といいます）の利用については、以下の事項にご同意の上、ユーザー自身の責任においてご利用いただくものとします。
      </p>
      <ol className="list-decimal pl-6 space-y-2">
        <li>本拡張機能はサロンボードの公式ツールではなく、当社が独自に提供する業務効率化のための補助ツールであり、株式会社リクルートとは一切関係ありません。</li>
        <li>本拡張機能の利用は、ホットペッパービューティーまたはサロンボードの利用規約により制限される可能性があり、その使用に起因してユーザーが当該サービスのアカウント停止・契約解除その他の措置を受けた場合であっても、当社は一切の責任を負わず、ユーザーに対するいかなる補償も行いません。</li>
        <li>ユーザーは、本拡張機能を自店舗の顧客データ取得の目的に限り使用するものとし、第三者提供・他店舗データ取得・大量自動アクセス等の不正利用は行わないものとします。</li>
        <li>ユーザーは、本拡張機能のダウンロード時に表示される免責事項に明示的に同意したものとみなし、当該同意の記録は法的記録として当社が保管します。</li>
      </ol>

      <h2 className="text-xl font-semibold mt-6">第8条（規約の変更）</h2>
      <p>当社は、必要と判断した場合、ユーザーに通知することなく本規約を変更できるものとします。</p>

      <p className="mt-8 text-muted-foreground">以上</p>
    </section>
  </div>
);
export default Terms;
