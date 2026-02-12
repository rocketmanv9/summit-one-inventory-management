const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cwmsvmywairkwdmvkdmw.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSummitSetup() {
  console.log('='.repeat(70));
  console.log('SUMMIT EVENT PUBLISHER PROTOCOL - DATABASE AUDIT');
  console.log('='.repeat(70));

  // Check for summit_bot role
  console.log('\n1. CHECKING FOR summit_bot ROLE:');
  console.log('   ⚠️  Cannot check roles via Supabase client (requires direct PostgreSQL access)');

  // Check for summit_config table
  console.log('\n2. CHECKING FOR summit_config TABLE:');
  const { data: summitConfig, error: configError } = await supabase
    .from('summit_config')
    .select('*')
    .limit(1);
  
  if (configError) {
    console.log(`   ❌ summit_config table: NOT FOUND`);
    console.log(`   Error: ${configError.message}`);
  } else {
    console.log(`   ✅ summit_config table: EXISTS`);
    console.log(`   Data:`, summitConfig);
  }

  // Check for event_catalog view
  console.log('\n3. CHECKING FOR event_catalog VIEW:');
  const { data: eventCatalog, error: catalogError } = await supabase
    .from('event_catalog')
    .select('*')
    .limit(1);
  
  if (catalogError) {
    console.log(`   ❌ event_catalog view: NOT FOUND`);
    console.log(`   Error: ${catalogError.message}`);
  } else {
    console.log(`   ✅ event_catalog view: EXISTS`);
    console.log(`   Sample:`, eventCatalog[0]);
  }

  // Check for events_outbox in public schema
  console.log('\n4. CHECKING FOR public.events_outbox:');
  const { data: publicOutbox, error: publicOutboxError } = await supabase
    .from('events_outbox')
    .select('*')
    .limit(1);
  
  if (publicOutboxError) {
    console.log(`   ❌ public.events_outbox: NOT FOUND`);
    console.log(`   Error: ${publicOutboxError.message}`);
  } else {
    console.log(`   ✅ public.events_outbox: EXISTS (unexpected!)`);
  }

  // Check for inventory.events_outbox
  console.log('\n5. CHECKING FOR inventory.events_outbox:');
  const { data: invOutbox, error: invOutboxError } = await supabase
    .schema('inventory')
    .from('events_outbox')
    .select('id, event_type, status, created_at')
    .limit(3);
  
  if (invOutboxError) {
    console.log(`   ❌ inventory.events_outbox: ERROR`);
    console.log(`   Error: ${invOutboxError.message}`);
  } else {
    console.log(`   ✅ inventory.events_outbox: EXISTS`);
    console.log(`   Records found: ${invOutbox.length}`);
    if (invOutbox.length > 0) {
      console.log(`   Sample:`, invOutbox[0]);
    }
  }

  // Check for events_dead_letter
  console.log('\n6. CHECKING FOR events_dead_letter:');
  const { data: deadLetter, error: deadLetterError } = await supabase
    .from('events_dead_letter')
    .select('*')
    .limit(1);
  
  if (deadLetterError) {
    console.log(`   ❌ events_dead_letter: NOT FOUND`);
    console.log(`   Error: ${deadLetterError.message}`);
  } else {
    console.log(`   ✅ events_dead_letter: EXISTS`);
  }

  // Check for emit_event function
  console.log('\n7. CHECKING FOR emit_event FUNCTION:');
  try {
    // Try to call it with minimal params (will fail but tells us if it exists)
    const { error: emitError } = await supabase.rpc('emit_event', {
      p_event_type: 'test.check',
      p_payload: {},
      p_tenant_id: '00000000-0000-0000-0000-000000000000'
    });
    
    if (emitError && emitError.message.includes('does not exist')) {
      console.log(`   ❌ emit_event function: NOT FOUND`);
    } else {
      console.log(`   ✅ emit_event function: EXISTS`);
      console.log(`   (Call result: ${emitError ? emitError.message : 'Success'})`);
    }
  } catch (e) {
    console.log(`   ⚠️  emit_event check failed: ${e.message}`);
  }

  // Check for register_event function
  console.log('\n8. CHECKING FOR register_event FUNCTION:');
  try {
    const { error: regError } = await supabase.rpc('register_event', {
      p_event_name: 'test.check',
      p_description: 'Test'
    });
    
    if (regError && regError.message.includes('does not exist')) {
      console.log(`   ❌ register_event function: NOT FOUND`);
    } else {
      console.log(`   ✅ register_event function: EXISTS`);
      console.log(`   (Call result: ${regError ? regError.message : 'Success'})`);
    }
  } catch (e) {
    console.log(`   ⚠️  register_event check failed: ${e.message}`);
  }

  // CRITICAL DIFFERENCES CHECK
  console.log('\n' + '='.repeat(70));
  console.log('COMPARISON WITH PROVIDED SCRIPT:');
  console.log('='.repeat(70));
  
  console.log('\n🔍 THE PROVIDED SCRIPT HAS:');
  console.log('   - summit_bot USER (with password)');
  console.log('   - public.events_outbox TABLE (not inventory schema)');
  console.log('   - public.event_catalog TABLE (not a view)');
  console.log('   - public.summit_config TABLE');
  console.log('   - public.events_dead_letter TABLE');
  console.log('   - Immutability triggers (fn_prevent_event_modification)');
  console.log('   - trace_id, correlation_id, causation_id columns');
  console.log('   - locked_at, locked_by columns for worker concurrency');
  console.log('   - attempts, next_attempt_at for retry backoff');

  console.log('\n🏗️ YOUR CURRENT SETUP HAS:');
  console.log('   - NO summit_bot user (archived in migrations_archive)');
  console.log('   - inventory.events_outbox (in inventory schema)');
  console.log('   - event_catalog as a VIEW over event_definitions');
  console.log('   - event_definitions table (base table)');
  console.log('   - Different column structure (event_name, retry_count vs attempts)');

  console.log('\n');
}

checkSummitSetup().catch(console.error);
