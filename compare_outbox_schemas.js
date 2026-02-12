const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cwmsvmywairkwdmvkdmw.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function compareSchemas() {
  console.log('\n' + '='.repeat(80));
  console.log('DETAILED COLUMN COMPARISON');
  console.log('='.repeat(80));

  // Get a sample record from inventory.events_outbox to see columns
  const { data: invSample } = await supabase
    .schema('inventory')
    .from('events_outbox')
    .select('*')
    .limit(1)
    .single();

  console.log('\n✅ CURRENT: inventory.events_outbox COLUMNS:');
  if (invSample) {
    Object.keys(invSample).sort().forEach(col => {
      console.log(`   - ${col}`);
    });
  }

  console.log('\n📋 PROVIDED SCRIPT: public.events_outbox COLUMNS:');
  const providedColumns = [
    'id',
    'event_type',
    'event_version',
    'payload',
    'aggregate_type',
    'aggregate_id',
    'status',
    'trace_id',
    'correlation_id',
    'causation_id',
    'tenant_id',
    'actor_user_id',
    'attempts',
    'error_message',
    'next_attempt_at',
    'last_attempt_at',
    'locked_at',
    'locked_by',
    'created_at',
    'published_at'
  ].sort();
  
  providedColumns.forEach(col => {
    console.log(`   - ${col}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('KEY DIFFERENCES:');
  console.log('='.repeat(80));

  const currentCols = invSample ? Object.keys(invSample).sort() : [];
  const missing = providedColumns.filter(col => !currentCols.includes(col));
  const extra = currentCols.filter(col => !providedColumns.includes(col));

  console.log('\n🔴 MISSING in current (present in provided script):');
  if (missing.length === 0) {
    console.log('   None');
  } else {
    missing.forEach(col => console.log(`   - ${col}`));
  }

  console.log('\n🟡 EXTRA in current (not in provided script):');
  if (extra.length === 0) {
    console.log('   None');
  } else {
    extra.forEach(col => console.log(`   - ${col}`));
  }

  console.log('\n' + '='.repeat(80));
  console.log('ARCHITECTURAL DIFFERENCES:');
  console.log('='.repeat(80));

  console.log('\n1️⃣ SCHEMA LOCATION:');
  console.log('   Current:  inventory.events_outbox');
  console.log('   Provided: public.events_outbox');

  console.log('\n2️⃣ EVENT REGISTRATION:');
  console.log('   Current:  event_definitions table (base) → event_catalog view');
  console.log('   Provided: event_catalog table (direct)');

  console.log('\n3️⃣ BOT USER:');
  console.log('   Current:  ❌ summit_bot NOT created (in migrations_archive)');
  console.log('   Provided: ✅ summit_bot user with BYPASSRLS');

  console.log('\n4️⃣ IMMUTABILITY:');
  console.log('   Current:  Unknown (need to check for fn_prevent_event_modification)');
  console.log('   Provided: ✅ fn_prevent_event_modification trigger');

  console.log('\n5️⃣ TRACING:');
  console.log('   Current:  ' + (currentCols.includes('trace_id') ? '✅' : '❌') + ' trace_id, ' + 
              (currentCols.includes('correlation_id') ? '✅' : '❌') + ' correlation_id, ' +
              (currentCols.includes('causation_id') ? '✅' : '❌') + ' causation_id');
  console.log('   Provided: ✅ All three tracing columns');

  console.log('\n6️⃣ RETRY MECHANISM:');
  console.log('   Current:  retry_count, last_retry_at');
  console.log('   Provided: attempts, last_attempt_at, next_attempt_at');

  console.log('\n7️⃣ WORKER LOCKING:');
  console.log('   Current:  ' + (currentCols.includes('locked_at') ? '✅' : '❌') + ' locked_at, ' +
              (currentCols.includes('locked_by') ? '✅' : '❌') + ' locked_by');
  console.log('   Provided: ✅ locked_at, locked_by');

  console.log('\n' + '='.repeat(80));
  console.log('VERDICT:');
  console.log('='.repeat(80));
  console.log('\n❌ NOT SET UP - Your database has a DIFFERENT event outbox implementation');
  console.log('\nYour current setup is:');
  console.log('  • inventory-specific (inventory schema)');
  console.log('  • Event-driven architecture with event_definitions');
  console.log('  • Similar but NOT the same as the provided script');
  console.log('\nThe provided script is:');
  console.log('  • Generic "Summit Publisher Protocol v1.2"');
  console.log('  • Direct event_catalog table (not a view)');
  console.log('  • summit_bot user for external polling');
  console.log('  • Public schema (service-agnostic)');
  console.log('\n🤔 MAKES SENSE? Both are valid, but they serve different purposes.');
  console.log('   Current: Inventory microservice internal eventing');
  console.log('   Provided: External event publishing protocol for inter-service communication');
  console.log('\n');
}

compareSchemas().catch(console.error);
