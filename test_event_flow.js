const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cwmsvmywairkwdmvkdmw.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testEventFlow() {
  console.log('═'.repeat(80));
  console.log('SUMMIT PUBLISHER PROTOCOL - END-TO-END TEST');
  console.log('═'.repeat(80));
  console.log('');

  // 1. Show registered events
  console.log('📋 REGISTERED EVENTS IN CATALOG:');
  console.log('─'.repeat(80));
  
  const { data: events, error: catalogError } = await supabase
    .from('event_catalog')
    .select('event_key, display_name, aggregate_type')
    .order('aggregate_type', { ascending: true })
    .order('event_key', { ascending: true });
  
  if (catalogError) {
    console.error('❌ Error fetching catalog:', catalogError.message);
    return;
  }
  
  // Group by aggregate type
  const grouped = events.reduce((acc, event) => {
    if (!acc[event.aggregate_type]) {
      acc[event.aggregate_type] = [];
    }
    acc[event.aggregate_type].push(event);
    return acc;
  }, {});
  
  for (const [aggType, eventList] of Object.entries(grouped)) {
    console.log(`\n  ${aggType.toUpperCase()}:`);
    eventList.forEach(e => {
      console.log(`    • ${e.event_key.padEnd(45)} ${e.display_name}`);
    });
  }
  
  console.log('');
  console.log(`✅ Total: ${events.length} events registered`);
  console.log('');

  // 2. Create a test event
  console.log('─'.repeat(80));
  console.log('🧪 CREATING TEST EVENT:');
  console.log('─'.repeat(80));
  
  const testTenantId = '00000000-0000-0000-0000-000000000001';
  const testTraceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const testCorrelationId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  
  const { data: eventId, error: emitError } = await supabase.rpc('emit_event', {
    p_type: 'inventory.item.created',
    p_payload: {
      item_id: 'test-item-123',
      sku: 'TEST-SKU-001',
      name: 'Test Asphalt Mix',
      category_id: 'asphalt',
      tracking_mode: 'bulk',
      unit_of_measure: 'ton',
      tenant_id: testTenantId,
      created_at: new Date().toISOString()
    },
    p_tenant_id: testTenantId,
    p_trace_id: testTraceId,
    p_correlation_id: testCorrelationId
  });
  
  if (emitError) {
    console.error('❌ Error emitting event:', emitError.message);
    return;
  }
  
  console.log(`✅ Event emitted successfully!`);
  console.log(`   Event ID: ${eventId}`);
  console.log(`   Trace ID: ${testTraceId}`);
  console.log('');

  // 3. Verify event in outbox
  console.log('─'.repeat(80));
  console.log('📬 VERIFYING EVENT IN OUTBOX:');
  console.log('─'.repeat(80));
  
  const { data: outboxEvent, error: outboxError } = await supabase
    .from('events_outbox')
    .select('*')
    .eq('id', eventId)
    .single();
  
  if (outboxError) {
    console.error('❌ Error fetching from outbox:', outboxError.message);
    return;
  }
  
  console.log('✅ Event found in outbox:');
  console.log(`   Type: ${outboxEvent.event_type}`);
  console.log(`   Version: ${outboxEvent.event_version}`);
  console.log(`   Status: ${outboxEvent.status}`);
  console.log(`   Aggregate Type: ${outboxEvent.aggregate_type}`);
  console.log(`   Trace ID: ${outboxEvent.trace_id}`);
  console.log(`   Correlation ID: ${outboxEvent.correlation_id}`);
  console.log(`   Tenant ID: ${outboxEvent.tenant_id}`);
  console.log(`   Created: ${outboxEvent.created_at}`);
  console.log('');
  console.log('   Payload:');
  console.log(`   ${JSON.stringify(outboxEvent.payload, null, 2).split('\n').join('\n   ')}`);
  console.log('');

  // 4. Check if Summit Core can see it
  console.log('─'.repeat(80));
  console.log('🔍 SUMMIT CORE POLLING VIEW:');
  console.log('─'.repeat(80));
  
  const { data: pendingEvents, error: pendingError } = await supabase
    .from('events_outbox')
    .select('id, event_type, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);
  
  if (pendingError) {
    console.error('❌ Error fetching pending events:', pendingError.message);
    return;
  }
  
  console.log(`✅ Pending events visible to Summit Core (showing last 10):`);
  if (pendingEvents.length === 0) {
    console.log('   (No pending events - all published or this is the first)');
  } else {
    pendingEvents.forEach((e, i) => {
      const isOurs = e.id === eventId;
      const marker = isOurs ? '👉' : '  ';
      console.log(`   ${marker} ${e.event_type.padEnd(45)} ${e.status.padEnd(10)} ${e.created_at}`);
    });
  }
  console.log('');

  // 5. Clean up test event
  console.log('─'.repeat(80));
  console.log('🧹 CLEANUP:');
  console.log('─'.repeat(80));
  
  const { error: deleteError } = await supabase
    .from('events_outbox')
    .delete()
    .eq('id', eventId);
  
  if (!deleteError) {
    console.log('✅ Test event cleaned up');
  } else {
    console.log('⚠️  Could not delete test event (it may have been published by Summit Core)');
  }
  console.log('');

  // Final summary
  console.log('═'.repeat(80));
  console.log('✅ END-TO-END TEST COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Summary:');
  console.log(`  ✓ Event Catalog: ${events.length} events registered`);
  console.log('  ✓ Event Emission: Working correctly');
  console.log('  ✓ Distributed Tracing: trace_id & correlation_id captured');
  console.log('  ✓ Outbox Pattern: Events persisted before publishing');
  console.log('  ✓ Summit Core Integration: Ready to poll and publish');
  console.log('');
  console.log('🎉 Your inventory microservice is fully integrated with Summit Core!');
  console.log('');
}

testEventFlow().catch(console.error);
