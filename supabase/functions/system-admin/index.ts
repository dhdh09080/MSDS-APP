import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength);
}

function requireUuid(value: unknown, label: string) {
  const id = String(value || '');
  if (!uuidPattern.test(id)) throw Object.assign(new Error(`${label} 값이 올바르지 않습니다.`), { status: 400 });
  return id;
}

async function listAllUsers(admin: ReturnType<typeof createClient>) {
  const users: any[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...(data.users || []));
    if ((data.users || []).length < 1000) break;
  }
  return users;
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown> = {},
) {
  const { error } = await admin.from('system_admin_audit_logs').insert({
    actor_id: actorId,
    action,
    target_type: targetType,
    target_id: targetId,
    details,
  });
  if (error) console.error('관리자 감사 로그 저장 실패:', error.message);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: '로그인 세션이 만료됐습니다.', code: 'AUTH_REQUIRED' }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: adminRole, error: roleError } = await admin.from('system_admins')
      .select('user_id').eq('user_id', user.id).maybeSingle();
    if (roleError) throw roleError;
    if (!adminRole) return json({ error: '시스템 관리자 권한이 필요합니다.', code: 'ADMIN_REQUIRED' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = cleanText(body.action || 'dashboard', 50);

    if (action === 'dashboard') {
      const users = await listAllUsers(admin);
      const [
        workspaceResult,
        memberResult,
        systemAdminResult,
        feedbackResult,
        aiResult,
        auditResult,
        msdsResult,
        bucketResult,
      ] = await Promise.all([
        admin.from('workspaces').select('id,name,code,owner_id,address,status,created_at').order('created_at', { ascending: false }),
        admin.from('workspace_members').select('id,workspace_id,user_id,role,created_at'),
        admin.from('system_admins').select('user_id,created_at'),
        admin.from('feedback_posts').select('id,author_id,author_name,category,feature_area,urgency,title,status,created_at').order('created_at', { ascending: false }).limit(100),
        admin.from('user_ai_credentials').select('user_id,provider,key_hint,status,last_error,last_validated_at'),
        admin.from('system_admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(80),
        admin.from('msds_records').select('workspace_id'),
        admin.storage.listBuckets(),
      ]);

      const firstError = [workspaceResult, memberResult, systemAdminResult, feedbackResult, aiResult, auditResult, msdsResult]
        .find((result) => result.error)?.error;
      if (firstError) throw firstError;

      const systemAdminIds = new Set((systemAdminResult.data || []).map((item) => item.user_id));
      const memberships = memberResult.data || [];
      const msdsCounts = (msdsResult.data || []).reduce((acc: Record<string, number>, row) => {
        acc[row.workspace_id] = (acc[row.workspace_id] || 0) + 1;
        return acc;
      }, {});
      const userById = new Map(users.map((item) => [item.id, item]));

      const safeUsers = users.map((item) => ({
        id: item.id,
        email: item.email || '',
        name: item.user_metadata?.name || item.email?.split('@')[0] || '사용자',
        createdAt: item.created_at,
        lastSignInAt: item.last_sign_in_at,
        emailConfirmedAt: item.email_confirmed_at,
        bannedUntil: item.banned_until,
        isSystemAdmin: systemAdminIds.has(item.id),
        memberships: memberships.filter((member) => member.user_id === item.id).map((member) => ({
          id: member.id,
          workspaceId: member.workspace_id,
          role: member.role,
          createdAt: member.created_at,
        })),
      }));

      const safeWorkspaces = (workspaceResult.data || []).map((workspace) => {
        const owner = userById.get(workspace.owner_id);
        return {
          ...workspace,
          ownerEmail: owner?.email || '',
          ownerName: owner?.user_metadata?.name || owner?.email?.split('@')[0] || '소유자 미확인',
          memberCount: memberships.filter((member) => member.workspace_id === workspace.id).length,
          msdsCount: msdsCounts[workspace.id] || 0,
        };
      });

      const feedback = feedbackResult.data || [];
      const aiIssues = (aiResult.data || []).filter((item) => item.status !== 'active');
      return json({
        me: { id: user.id, email: user.email || '', name: user.user_metadata?.name || user.email?.split('@')[0] || '시스템 관리자' },
        metrics: {
          users: safeUsers.length,
          workspaces: safeWorkspaces.length,
          activeWorkspaces: safeWorkspaces.filter((item) => item.status === 'active').length,
          systemAdmins: systemAdminIds.size,
          openFeedback: feedback.filter((item) => ['received', 'reviewing', 'planned'].includes(item.status)).length,
          aiIssues: aiIssues.length,
        },
        health: {
          database: true,
          auth: true,
          storage: !bucketResult.error,
          edgeFunction: true,
          checkedAt: new Date().toISOString(),
        },
        workspaces: safeWorkspaces,
        users: safeUsers,
        feedback,
        aiIssues,
        auditLogs: auditResult.data || [],
      });
    }

    if (action === 'update-workspace') {
      const workspaceId = requireUuid(body.workspaceId, '현장');
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = cleanText(body.name, 100);
        if (name.length < 2) return json({ error: '현장명은 2자 이상 입력해주세요.' }, 400);
        updates.name = name;
      }
      if (body.status !== undefined) {
        const status = cleanText(body.status, 20);
        if (!['active', 'suspended', 'archived'].includes(status)) return json({ error: '지원하지 않는 현장 상태입니다.' }, 400);
        updates.status = status;
      }
      if (!Object.keys(updates).length) return json({ error: '변경할 항목이 없습니다.' }, 400);
      const { data, error } = await admin.from('workspaces').update(updates).eq('id', workspaceId).select('id,name,status').single();
      if (error) throw error;
      await writeAudit(admin, user.id, 'workspace.update', 'workspace', workspaceId, updates);
      return json({ ok: true, workspace: data });
    }

    if (action === 'set-membership') {
      const workspaceId = requireUuid(body.workspaceId, '현장');
      const targetUserId = requireUuid(body.userId, '사용자');
      const role = cleanText(body.role, 20);
      if (!['admin', 'member'].includes(role)) return json({ error: '지원하지 않는 권한입니다.' }, 400);
      const { data: workspace, error: workspaceError } = await admin.from('workspaces')
        .select('owner_id').eq('id', workspaceId).single();
      if (workspaceError) throw workspaceError;
      if (workspace.owner_id === targetUserId && role !== 'admin') return json({ error: '현장 소유자의 관리자 권한은 낮출 수 없습니다.' }, 400);
      const { data: existing, error: existingError } = await admin.from('workspace_members')
        .select('id').eq('workspace_id', workspaceId).eq('user_id', targetUserId).maybeSingle();
      if (existingError) throw existingError;
      const result = existing
        ? await admin.from('workspace_members').update({ role }).eq('id', existing.id)
        : await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: targetUserId, role });
      if (result.error) throw result.error;
      await writeAudit(admin, user.id, 'membership.set', 'user', targetUserId, { workspaceId, role });
      return json({ ok: true });
    }

    if (action === 'remove-membership') {
      const workspaceId = requireUuid(body.workspaceId, '현장');
      const targetUserId = requireUuid(body.userId, '사용자');
      const { data: workspace, error: workspaceError } = await admin.from('workspaces')
        .select('owner_id').eq('id', workspaceId).single();
      if (workspaceError) throw workspaceError;
      if (workspace.owner_id === targetUserId) return json({ error: '현장 소유자는 현장에서 제거할 수 없습니다.' }, 400);
      const { error } = await admin.from('workspace_members').delete()
        .eq('workspace_id', workspaceId).eq('user_id', targetUserId);
      if (error) throw error;
      await writeAudit(admin, user.id, 'membership.remove', 'user', targetUserId, { workspaceId });
      return json({ ok: true });
    }

    if (action === 'set-system-admin') {
      const targetUserId = requireUuid(body.userId, '사용자');
      const enabled = body.enabled === true;
      if (!enabled && targetUserId === user.id) return json({ error: '현재 로그인한 본인의 시스템 관리자 권한은 해제할 수 없습니다.' }, 400);
      const { data: targetUser, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetUser.user) return json({ error: '사용자 계정을 찾을 수 없습니다.' }, 404);
      const result = enabled
        ? await admin.from('system_admins').upsert({ user_id: targetUserId })
        : await admin.from('system_admins').delete().eq('user_id', targetUserId);
      if (result.error) throw result.error;
      await writeAudit(admin, user.id, enabled ? 'system_admin.grant' : 'system_admin.revoke', 'user', targetUserId);
      return json({ ok: true });
    }

    if (action === 'set-user-access') {
      const targetUserId = requireUuid(body.userId, '사용자');
      const suspended = body.suspended === true;
      if (targetUserId === user.id) return json({ error: '현재 로그인한 본인 계정은 정지할 수 없습니다.' }, 400);
      const { data: targetAdmin } = await admin.from('system_admins').select('user_id').eq('user_id', targetUserId).maybeSingle();
      if (suspended && targetAdmin) return json({ error: '시스템 관리자 계정은 먼저 관리자 권한을 해제해야 정지할 수 있습니다.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: suspended ? '876000h' : 'none',
      });
      if (error) throw error;
      await writeAudit(admin, user.id, suspended ? 'user.suspend' : 'user.restore', 'user', targetUserId);
      return json({ ok: true });
    }

    return json({ error: '지원하지 않는 관리자 작업입니다.' }, 400);
  } catch (error) {
    const err = error as Error & { status?: number; code?: string };
    console.error('시스템 관리자 처리 실패:', err.message);
    return json({ error: err.message || '관리자 작업 중 오류가 발생했습니다.', code: err.code || 'SYSTEM_ADMIN_ERROR' }, err.status || 500);
  }
});
