/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
const callers = new Set()
const counts = { total: 0 }

Bun.serve({
  hostname: '0.0.0.0',
  port: 8080,
  async fetch(request, server) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ready: true })
    }
    if (request.method === 'GET' && url.pathname === '/stats') {
      return Response.json({ ...counts, callers: [...callers] })
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      return new Response('Not found', { status: 404 })
    }
    const body = await request.json()
    if (
      body.model !== 'gpt-4o-mini' ||
      (body.max_tokens ?? body.max_completion_tokens) !== 8
    ) {
      return Response.json(
        { error: { message: 'Unexpected local fixture' } },
        { status: 400 }
      )
    }
    counts.total++
    callers.add(
      (server.requestIP(request)?.address || 'unknown').replace(/^::ffff:/, '')
    )
    return Response.json({
      id: 'isolated-container-affinity-fixture',
      object: 'chat.completion',
      model: 'gpt-4o-mini',
      created: 1,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'local fixture' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  },
})
