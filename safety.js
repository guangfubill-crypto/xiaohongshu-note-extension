"use strict";

(() => {
  const rules = [
    {
      id: "lead",
      label: "疑似站外导流",
      severity: "block",
      suggestion: "删除联系方式、加群、私信索取、二维码或站外链接，改为在当前笔记内完整说明。",
      patterns: [/微信|微\s*信|vx|v信|加我|加群|群号|扫码|二维码|联系方式|手机号|电话|私聊我|私信我|主页(?:有|见)|淘口令|外链/gi]
    },
    {
      id: "promise",
      label: "虚假或收益承诺",
      severity: "block",
      suggestion: "只陈述自己可验证的真实结果，并注明个体差异。",
      patterns: [/包过|稳赚|躺赚|保证(?:有效|成功)|三天见效|零风险|无副作用|月入\s*\d+[万w]?/gi]
    },
    {
      id: "engagement",
      label: "诱导互动或互刷",
      severity: "block",
      suggestion: "改成与内容相关、读者可以自然回答的具体问题。",
      patterns: [/互赞|互关|回关|求赞|求关注|点赞收藏关注|三连|评论区扣\s*[1一]/gi]
    },
    {
      id: "absolute",
      label: "绝对化表达",
      severity: "warn",
      suggestion: "改成个人体验，例如“我用过的里面更合适”或“目前对我有效”。",
      patterns: [/全网最低|国家级|世界级|顶级|唯一|永久|百分之百|100\s*%|绝对(?:有效|不会|安全)|最好用/gi]
    },
    {
      id: "medical",
      label: "医疗或功效化表达",
      severity: "warn",
      suggestion: "只写自己的体感或观感，不做诊断、治疗和普遍功效承诺。",
      patterns: [/治疗|治愈|消炎|祛痘|抗炎|疗效|药用|医美级|修复受损|提高免疫力|降血糖|排毒/gi]
    },
    {
      id: "attack",
      label: "贬低或定性攻击",
      severity: "warn",
      suggestion: "限定为自己的这次体验和可验证事实，不给品牌或个人下定性结论。",
      patterns: [/骗子|假货|黑心|垃圾|智商税|别买\s*[^，。！？\s]{1,20}/gi]
    }
  ];

  const placeholderPattern = /【[^】]*(?:补充|填写|问题|细节|真实)[^】]*】|\[[^\]]*(?:补充|填写|问题|细节|真实)[^\]]*\]/gi;

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[\s，。！？、,.!?~～·“”"'‘’（）()【】\[\]]+/g, "");
  }

  function reviewText(value, options = {}) {
    const text = String(value || "").trim();
    const mode = options.mode === "comment" ? "comment" : "draft";
    const findings = [];
    for (const rule of rules) {
      const matches = [];
      for (const pattern of rule.patterns) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) matches.push(match[0]);
      }
      if (matches.length) findings.push({
        id: rule.id,
        label: rule.label,
        severity: mode === "comment" ? "block" : rule.severity,
        matches: [...new Set(matches)].slice(0, 8),
        suggestion: rule.suggestion
      });
    }
    placeholderPattern.lastIndex = 0;
    const placeholders = [...text.matchAll(placeholderPattern)].map((match) => match[0]);
    if (placeholders.length) findings.push({
      id: "placeholder",
      label: "模板内容尚未补全",
      severity: "block",
      matches: [...new Set(placeholders)],
      suggestion: "把占位内容替换成与当前笔记直接相关的真实细节。"
    });
    if (mode === "comment" && text.length < 8) findings.push({
      id: "short",
      label: "评论过短",
      severity: "block",
      matches: [],
      suggestion: "至少写 8 个字，并加入与当前笔记相关的具体信息。"
    });
    if (mode === "comment" && text.length > 180) findings.push({
      id: "long",
      label: "评论过长",
      severity: "block",
      matches: [],
      suggestion: "精简到 180 字以内，避免像广告或复制粘贴的长文。"
    });
    return {
      ok: !findings.some((item) => item.severity === "block"),
      findings,
      blockers: findings.filter((item) => item.severity === "block"),
      warnings: findings.filter((item) => item.severity === "warn")
    };
  }

  function similarity(left, right) {
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const grams = (value) => {
      const result = new Set();
      for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
      return result;
    };
    const aa = grams(a);
    const bb = grams(b);
    let overlap = 0;
    for (const item of aa) if (bb.has(item)) overlap += 1;
    return overlap / Math.max(1, aa.size + bb.size - overlap);
  }

  globalThis.XhsSafety = { rules, normalize, reviewText, similarity };
})();
