import { describe, expect, it, vi } from 'vitest';
import { listarFeaturesAtivas } from '#core/tenant/feature-flags.js';
import { listarModulosAtivos } from '#core/tenant/module-access.js';
import { getSessionUser } from './login.service.js';

vi.mock('#core/tenant/module-access.js', () => ({ listarModulosAtivos: vi.fn() }));
vi.mock('#core/tenant/feature-flags.js', () => ({ listarFeaturesAtivas: vi.fn() }));
vi.mock('#core/email/smtp.js', () => ({}));
vi.mock('../repositories/login.repository.js', () => ({}));

describe('getSessionUser', () => {
  it('junta o contexto do token com módulos e features do tenant', async () => {
    const tenantContext = { tenantId: 't-1', userId: 'u-1', role: 'DONO' };
    listarModulosAtivos.mockResolvedValue(['crm']);
    listarFeaturesAtivas.mockResolvedValue(['crm.layout']);

    await expect(getSessionUser(tenantContext)).resolves.toEqual({
      ...tenantContext,
      modulosAtivos: ['crm'],
      featuresAtivas: ['crm.layout'],
    });
    expect(listarFeaturesAtivas).toHaveBeenCalledWith('t-1');
  });
});
