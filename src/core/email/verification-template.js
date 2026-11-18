/**
 * @file HTML de e-mail usa tabelas e estilos inline, sem fontes ou imagens externas.
 */
const CONTENT = Object.freeze({
  activation: {
    context: 'BEM-VINDO AO FLOW CRM',
    title: 'Crie sua senha',
    description:
      'Falta pouco para começar. Use o código abaixo para verificar seu e-mail e criar sua senha de acesso.',
  },
  recovery: {
    context: 'RECUPERAÇÃO DE CONTA',
    title: 'Recupere seu acesso',
    description:
      'Recebemos uma solicitação para recuperar sua conta. Use o código abaixo para confirmar sua identidade e definir uma nova senha.',
  },
  login: {
    context: 'ACESSO SEGURO',
    title: 'Confirme seu acesso',
    description:
      'Use o código abaixo para concluir o login no Flow CRM. Esta verificação ajuda a manter sua conta protegida.',
  },
});

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

/**
 * HTML de e-mail usa tabelas e estilos inline, sem fontes ou imagens externas.
 * @param {{ purpose: 'activation' | 'recovery' | 'login', code: string, expirationMinutes: number }} input
 * @returns {{ html: string, text: string }}
 */
export function renderVerificationEmail({ purpose, code, expirationMinutes }) {
  const content = CONTENT[purpose];

  if (!content) {
    throw new TypeError('Finalidade de e-mail de verificação inválida');
  }

  const expires = `${expirationMinutes} ${expirationMinutes === 1 ? 'minuto' : 'minutos'}`;
  const safeCode = escapeHtml(code);
  const safeExpires = escapeHtml(expires);
  const text = [
    'Flow CRM',
    content.title,
    '',
    content.description,
    '',
    `Seu código de verificação é ${code}.`,
    `Ele expira em ${expires}.`,
    '',
    'Não compartilhe este código com outras pessoas.',
    'Se você não fez esta solicitação, ignore esta mensagem.',
    '',
    'Esta é uma mensagem automática do Flow CRM.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${content.title} · Flow CRM</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#192b45;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${content.title}. Seu código de verificação expira em ${safeExpires}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6">
    <tr><td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:560px;border:1px solid #dce4f0;border-radius:16px;border-spacing:0;overflow:hidden;">
        <tr><td bgcolor="#10151b" style="padding:28px 24px;border-radius:15px 15px 0 0;border-bottom:3px solid #e47720;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="40" height="40" align="center" valign="middle" style="background-color:#241b13;border:1px solid #78451d;border-radius:10px;color:#e47720;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:38px;">&#8594;</td>
            <td style="padding-left:12px;font-size:23px;line-height:32px;font-weight:700;color:#f5f7fa;">Flow <span style="color:#e47720;font-size:16px;font-weight:500;letter-spacing:3px;">CRM</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px 24px 16px;">
          <p style="margin:0 0 12px;font-size:11px;line-height:18px;font-weight:700;letter-spacing:1.5px;color:#667085;">${content.context}</p>
          <h1 style="margin:0 0 14px;font-size:26px;line-height:34px;font-weight:700;letter-spacing:-0.5px;color:#192b45;">${content.title}</h1>
          <p style="margin:0;font-size:15px;line-height:24px;color:#52627a;">${content.description}</p>
        </td></tr>
        <tr><td style="padding:8px 24px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fff6ed" style="border:1px solid #f3d0b2;border-radius:12px;">
            <tr><td align="center" style="padding:20px 12px 8px;font-size:11px;line-height:18px;font-weight:700;letter-spacing:1px;color:#8a4310;">SEU CÓDIGO DE VERIFICAÇÃO</td></tr>
            <tr><td align="center" dir="ltr" style="padding:0 4px 14px;font-family:'Courier New',Courier,monospace;font-size:36px;line-height:46px;font-weight:700;letter-spacing:6px;color:#192b45;">${safeCode}</td></tr>
            <tr><td align="center" style="padding:0 12px 20px;font-size:13px;line-height:20px;color:#8a4310;">Válido por <strong>${safeExpires}</strong>.</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 24px 32px;">
          <p style="margin:0 0 8px;font-size:13px;line-height:21px;color:#192b45;font-weight:700;">Não compartilhe este código com outras pessoas.</p>
          <p style="margin:0;font-size:13px;line-height:21px;color:#667085;">Se você não fez esta solicitação, ignore esta mensagem.</p>
        </td></tr>
        <tr><td bgcolor="#fafafa" style="padding:18px 24px;border-top:1px solid #e7ebf0;border-radius:0 0 15px 15px;">
          <p style="margin:0;font-size:12px;line-height:20px;color:#667085;">Esta é uma mensagem automática do <strong style="color:#52627a;">Flow CRM</strong>.</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;

  return { html, text };
}
