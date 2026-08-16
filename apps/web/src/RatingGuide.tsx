import React from 'react'
import { useI18n } from './i18n'
import './rating-queue.css'

type GuideSection = {
  title: string
  body: React.ReactNode
}

export function RatingGuidePage() {
  const { locale } = useI18n()
  const ja = locale === 'ja'

  const sections: GuideSection[] = ja ? [
    {
      title: '0. まず対象Versionを確認する',
      body: <>
        <p>査定はLevel全体ではなく、指定されたVersionに対して行います。Version名・SHA-256・配布URLを確認し、別Versionを遊んでいないかを最初に確認してください。</p>
        <p>譜面が壊れている、明らかに音ズレしている、正常な査定ができないなどの場合は、無理にP/G/Uを付けず担当を外してスタッフに伝えてください。</p>
      </>,
    },
    {
      title: '1. 先に自分で判断する',
      body: <>
        <p>査定前は、確定難易度・他の人の査定・TUFなど外部サイトのRatingを答えとして見ないでください。先に数字を見ると、その数字へ判断が引っ張られます。</p>
        <p>既にRatingを知っている譜面でも、「その数字に合わせる」のではなく、実際に遊んだ感触とReferenceとの比較から独立して判断します。</p>
      </>,
    },
    {
      title: '2. Family（P / G / U）を選ぶ',
      body: <>
        <p>まず大きな難易度帯を選びます。自分がクリアできたかどうかだけではなく、近いReferenceや同系統の譜面と比較してください。</p>
        <p>「有名だから高い」「自分の苦手配置だから高い」ではなく、譜面が要求する操作・認識・精度を、同じ基準で比較するのが目的です。</p>
      </>,
    },
    {
      title: '3. Anchor Tierを選ぶ',
      body: <>
        <p>次に、そのFamilyの中で最も近い整数Tierを選びます。G8とG9の間に感じる場合も、まず「どちらを基準にする方が近いか」を決めます。</p>
        <div className="rating-guide-example"><strong>例</strong><span>G8より明確に難しいが、G9よりはG8に近い → AnchorはG8</span></div>
      </>,
    },
    {
      title: '4. Lean（-2 ～ +2）でTier内の位置を補う',
      body: <>
        <div className="rating-guide-scale">
          <span><b>-2</b>かなり下寄り</span>
          <span><b>-1</b>やや下寄り</span>
          <span><b>0</b>中央・妥当</span>
          <span><b>+1</b>やや上寄り</span>
          <span><b>+2</b>かなり上寄り</span>
        </div>
        <p>Leanは「G8.2」のような公式の小数難易度ではありません。あくまで人間の査定を粗く表すEvidenceです。</p>
        <p>境界付近なら、G8 +2 と G9 -2 のどちらが自然かをReferenceとの距離で決めてください。小数値を逆算して当てに行く必要はありません。</p>
      </>,
    },
    {
      title: '5. Confidenceは「自分の強さ」ではなく判断の確かさ',
      body: <>
        <div className="rating-guide-confidence">
          <span><b>1</b>かなり不確か。十分な比較ができていない</span>
          <span><b>2</b>やや不確か。候補はあるが迷いが大きい</span>
          <span><b>3</b>通常。妥当だと思うが多少の揺れはある</span>
          <span><b>4</b>かなり確か。近いReferenceと比較できた</span>
          <span><b>5</b>非常に確か。十分に検証でき、判断根拠も明確</span>
        </div>
        <p>クリアが安定しているから5、上手いプレイヤーだから5、ではありません。迷っているなら低く付けて大丈夫です。</p>
      </>,
    },
    {
      title: '6. コメントには「なぜ」を残す',
      body: <>
        <p>コメントは任意ですが、意見が割れたときに非常に役立ちます。単に「むずい」ではなく、判断を動かした要素を書いてください。</p>
        <div className="rating-guide-example"><strong>良い例</strong><span>終盤の高速認識がG8 Reference Aより強いが、全体ではG9 Reference Bほどではない。G8上寄り。</span></div>
        <p>特定区間だけが極端に難しい、得意不得意の影響が大きい、プレイ回数が少ない、といった不確実性も書いて構いません。</p>
      </>,
    },
  ] : [
    {
      title: '0. Verify the target Version first',
      body: <>
        <p>A rating belongs to a specific Level Version, not to the Level in the abstract. Check the Version label, SHA-256 and download link before judging it.</p>
        <p>If the chart is broken, obviously off-sync, or otherwise cannot be judged normally, do not invent a P/G/U rating. Release the claim and tell staff.</p>
      </>,
    },
    {
      title: '1. Form an independent judgment first',
      body: <>
        <p>Before submitting, do not use the confirmed difficulty, peer votes, TUF or another external rating as an answer key. Seeing a number first creates anchoring.</p>
        <p>If you already know a published rating, still compare the chart to references and judge it independently instead of fitting your vote to that number.</p>
      </>,
    },
    {
      title: '2. Choose the Family (P / G / U)',
      body: <>
        <p>Pick the broad difficulty family first. Compare against nearby references and charts with similar demands rather than using only your own clear/fail result.</p>
        <p>Reputation and personal skill bias are not the scale. Compare the execution, reading and precision the chart actually demands.</p>
      </>,
    },
    {
      title: '3. Choose an Anchor Tier',
      body: <>
        <p>Choose the nearest integer tier inside that Family. If a chart feels between G8 and G9, first decide which tier is the better anchor.</p>
        <div className="rating-guide-example"><strong>Example</strong><span>Clearly harder than G8, but still closer to G8 than G9 → anchor G8.</span></div>
      </>,
    },
    {
      title: '4. Use Lean (-2 to +2) for position inside the tier',
      body: <>
        <div className="rating-guide-scale">
          <span><b>-2</b>strongly lower</span>
          <span><b>-1</b>slightly lower</span>
          <span><b>0</b>center / appropriate</span>
          <span><b>+1</b>slightly higher</span>
          <span><b>+2</b>strongly higher</span>
        </div>
        <p>Lean is not an official decimal rating such as “G8.2”. It is deliberately coarse human evidence.</p>
        <p>Near a boundary, choose between values such as G8 +2 and G9 -2 by which reference anchor is closer. Do not reverse-engineer a decimal target.</p>
      </>,
    },
    {
      title: '5. Confidence means confidence in the judgment',
      body: <>
        <div className="rating-guide-confidence">
          <span><b>1</b>very uncertain; not enough comparison</span>
          <span><b>2</b>somewhat uncertain; large remaining doubt</span>
          <span><b>3</b>normal; reasonable with some uncertainty</span>
          <span><b>4</b>high confidence; compared against close references</span>
          <span><b>5</b>very high confidence; well tested with a clear basis</span>
        </div>
        <p>Confidence is not your player skill and is not automatically 5 because you can clear the chart consistently.</p>
      </>,
    },
    {
      title: '6. Leave the “why” in the comment',
      body: <>
        <p>Comments are optional, but they are valuable when raters disagree. Record what actually moved your judgment instead of writing only “hard”.</p>
        <div className="rating-guide-example"><strong>Good example</strong><span>The ending reading section is above G8 Reference A, but the chart overall is below G9 Reference B. High G8.</span></div>
        <p>You can also mention a single dominant spike, strong personal skill bias, or too few attempts when those make the result less certain.</p>
      </>,
    },
  ]

  const commonMistakes = ja ? [
    '1回失敗しただけで高くする / 1回通っただけで低くする',
    '自分の得意・苦手をそのまま難易度基準にする',
    '既存Ratingを見てから、その数字に寄せる',
    'Leanを公式の小数難易度として細かく計算する',
    'Confidenceを常に5にする',
    '別Versionを遊んだまま送信する',
  ] : [
    'Raising it because of one fail, or lowering it because of one clear',
    'Turning your personal strengths and weaknesses directly into the scale',
    'Looking up an existing rating and then fitting your vote to it',
    'Treating Lean as an official decimal difficulty',
    'Using confidence 5 by default',
    'Submitting after playing the wrong Version',
  ]

  const checklist = ja ? [
    '対象Versionを確認した',
    '外部Ratingや他人の票を答えとして見ていない',
    '近いReferenceと比較した',
    'FamilyとAnchor Tierを先に決めた',
    'LeanはTier内の位置として選んだ',
    'Confidenceは判断の確かさに合わせた',
    '迷いがあるならコメントに残した',
  ] : [
    'I verified the target Version',
    'I did not use external or peer ratings as an answer key',
    'I compared against nearby references',
    'I chose the Family and Anchor Tier first',
    'I used Lean only as position within the tier',
    'Confidence reflects how certain the judgment is',
    'I explained important uncertainty in the comment',
  ]

  return <section className="rating-guide-page">
    <div className="section-head">
      <div>
        <p className="eyebrow">ELF Rating Guide</p>
        <h1>{ja ? '譜面査定ガイド' : 'Level Rating Guide'}</h1>
        <p className="muted">{ja
          ? 'Ratingは「正解を当てる投票」ではなく、独立した人間の判断をEvidenceとして残す作業です。'
          : 'A rating is not a vote to guess the official answer. It records an independent human judgment as evidence.'}</p>
      </div>
      <a className="button" href="#/rating-queue">{ja ? '査定キューへ' : 'Open Rating Queue'}</a>
    </div>

    <div className="panel rating-guide-principle">
      <strong>{ja ? '最重要ルール' : 'Most important rule'}</strong>
      <p>{ja
        ? 'まず自分で査定し、その後で他のRatingを見る。TUFや既存の確定難易度は、現在の査定の答え合わせとして先に使わない。'
        : 'Judge independently first, then look at other ratings afterward. Do not use TUF or an existing confirmed difficulty as the answer key for the current task.'}</p>
    </div>

    <div className="rating-guide-sections">
      {sections.map((section) => <article className="panel rating-guide-section" key={section.title}>
        <h2>{section.title}</h2>
        {section.body}
      </article>)}
    </div>

    <div className="two-col rating-guide-bottom">
      <div className="panel">
        <h2>{ja ? 'よくあるミス' : 'Common mistakes'}</h2>
        <ul>{commonMistakes.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
      <div className="panel">
        <h2>{ja ? '送信前チェック' : 'Before submitting'}</h2>
        <ul className="rating-guide-checklist">{checklist.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
    </div>

    <div className="panel rating-guide-review-flow">
      <h2>{ja ? '送信した後はどうなる？' : 'What happens after submission?'}</h2>
      <div className="rating-guide-flow">
        <span>{ja ? '独立査定' : 'Independent rating'}</span><b>→</b>
        <span>{ja ? '2票が近い' : '2 close votes'}</span><b>→</b>
        <span>Review Ready</span>
      </div>
      <div className="rating-guide-flow">
        <span>{ja ? '意見が割れる' : 'Votes disagree'}</span><b>→</b>
        <span>{ja ? '3人目を募集' : 'Request third rater'}</span><b>→</b>
        <span>{ja ? 'スタッフ確認' : 'Staff review'}</span>
      </div>
      <p className="muted">{ja
        ? 'あなたの1票がそのまま確定難易度になるわけではありません。だから、他人に合わせるより独立した判断の方が価値があります。'
        : 'Your single vote does not directly become the confirmed difficulty. Independent disagreement is more useful than copying another rater.'}</p>
    </div>

    <div className="panel rating-guide-special">
      <h2>{ja ? '通常Ratingにできない譜面' : 'Charts that cannot be rated normally'}</h2>
      <p>{ja
        ? 'Mischarted、Offsync、著しいVisual問題、Copyrightなど、そもそも通常のP/G/U査定に載せるべきでない問題を見つけた場合は、無理に数字を付けないでください。Censored用の専用フローを実装するまでは担当を外し、スタッフへ理由を伝える運用にします。'
        : 'If the chart is mischarted, off-sync, severely unreadable, has a copyright problem, or otherwise should not enter normal P/G/U rating, do not force a numeric judgment. Until the dedicated Censored flow exists, release the claim and tell staff why.'}</p>
    </div>
  </section>
}
