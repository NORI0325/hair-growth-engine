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

      <h2 className="text-xl font-semibold mt-6">第7条（規約の変更）</h2>
      <p>当社は、必要と判断した場合、ユーザーに通知することなく本規約を変更できるものとします。</p>

      <p className="mt-8 text-muted-foreground">以上</p>
    </section>
  </div>
);
export default Terms;
