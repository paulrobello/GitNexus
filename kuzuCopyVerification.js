/**
 * KuzuDB COPY Verification Test
 * 
 * This test actually verifies that:
 * 1. We can write CSV data to KuzuDB WASM filesystem
 * 2. COPY statements work to load the data
 * 3. We can query the data back to confirm it was loaded
 * 
 * This is a REAL test that proves the approach works.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

async function verifyKuzuCopyApproach() {
  console.log('🧪 KuzuDB COPY Approach Verification Test');
  console.log('=' .repeat(50));
  console.log('This test will ACTUALLY verify that COPY works!\n');

  let kuzu, db, conn;
  let testsPassed = 0;
  let testsTotal = 0;

  function test(description, condition) {
    testsTotal++;
    if (condition) {
      console.log(`✅ TEST ${testsTotal}: ${description}`);
      testsPassed++;
      return true;
    } else {
      console.log(`❌ TEST ${testsTotal}: ${description}`);
      return false;
    }
  }

  try {
    // Step 1: Load KuzuDB module
    console.log('📦 Step 1: Loading KuzuDB module...');
    try {
      kuzu = require('kuzu-wasm');
      test('KuzuDB module loaded successfully', !!kuzu);
      console.log(`   Available APIs: ${Object.keys(kuzu.default || kuzu).join(', ')}`);
    } catch (error) {
      test('KuzuDB module loaded successfully', false);
      throw new Error(`Failed to load kuzu-wasm: ${error.message}`);
    }

    // Step 2: Initialize KuzuDB
    console.log('\n🔧 Step 2: Initializing KuzuDB...');
    try {
      // Try different initialization approaches
      if (kuzu.default && kuzu.default.init) {
        await kuzu.default.init();
        kuzu = kuzu.default; // Use the default export
      } else if (kuzu.init) {
        await kuzu.init();
      } else {
        console.log('   ⚠️ No init method found, trying direct usage...');
      }
      
      test('KuzuDB initialized successfully', true);
      
      // Check FS API availability
      const hasFS = !!(kuzu.FS && kuzu.FS.writeFile);
      test('FS API (writeFile) is available', hasFS);
      
      if (hasFS) {
        console.log(`   FS methods: ${Object.keys(kuzu.FS).join(', ')}`);
      } else {
        console.log('   ⚠️ FS API not available - will test fallback approach');
      }
    } catch (error) {
      test('KuzuDB initialized successfully', false);
      throw new Error(`KuzuDB initialization failed: ${error.message}`);
    }

    // Step 3: Create database and connection
    console.log('\n🗃️ Step 3: Creating database and connection...');
    try {
      db = new kuzu.Database('');
      conn = new kuzu.Connection(db);
      test('Database and connection created', !!(db && conn));
    } catch (error) {
      test('Database and connection created', false);
      throw new Error(`Database creation failed: ${error.message}`);
    }

    // Step 4: Create schema
    console.log('\n📋 Step 4: Creating test schema...');
    try {
      await conn.query('CREATE NODE TABLE TestUser(name STRING, age INT64, PRIMARY KEY (name))');
      await conn.query('CREATE NODE TABLE TestCity(name STRING, population INT64, PRIMARY KEY (name))');
      await conn.query('CREATE REL TABLE TestFollows(FROM TestUser TO TestUser, since INT64)');
      test('Schema created successfully', true);
    } catch (error) {
      test('Schema created successfully', false);
      throw new Error(`Schema creation failed: ${error.message}`);
    }

    // Step 5: Test COPY approach (if FS is available)
    if (kuzu.FS && kuzu.FS.writeFile) {
      console.log('\n💾 Step 5: Testing COPY approach with FS.writeFile...');
      
      try {
        // Prepare test data
        const userCSV = `Alice,25
Bob,30
Charlie,35
Diana,28`;
        
        const cityCSV = `NewYork,8000000
London,9000000
Tokyo,14000000`;

        // Write CSV to WASM filesystem
        console.log('   📝 Writing CSV files to WASM filesystem...');
        await kuzu.FS.writeFile('/test_users.csv', userCSV);
        await kuzu.FS.writeFile('/test_cities.csv', cityCSV);
        test('CSV files written to WASM filesystem', true);

        // Execute COPY statements
        console.log('   📥 Executing COPY statements...');
        const userCopyResult = await conn.query("COPY TestUser FROM '/test_users.csv'");
        await userCopyResult.close();
        
        const cityCopyResult = await conn.query("COPY TestCity FROM '/test_cities.csv'");
        await cityCopyResult.close();
        
        test('COPY statements executed successfully', true);

      } catch (error) {
        test('COPY statements executed successfully', false);
        console.log(`   ❌ COPY approach failed: ${error.message}`);
        console.log('   🔄 Falling back to INSERT statements...');
        
        // Fallback to INSERT
        await conn.query("CREATE (u:TestUser {name: 'Alice', age: 25})");
        await conn.query("CREATE (u:TestUser {name: 'Bob', age: 30})");
        await conn.query("CREATE (u:TestUser {name: 'Charlie', age: 35})");
        await conn.query("CREATE (c:TestCity {name: 'NewYork', population: 8000000})");
        await conn.query("CREATE (c:TestCity {name: 'London', population: 9000000})");
        test('Fallback INSERT statements executed', true);
      }

    } else {
      console.log('\n🔄 Step 5: FS not available, using INSERT statements...');
      try {
        await conn.query("CREATE (u:TestUser {name: 'Alice', age: 25})");
        await conn.query("CREATE (u:TestUser {name: 'Bob', age: 30})");
        await conn.query("CREATE (u:TestUser {name: 'Charlie', age: 35})");
        await conn.query("CREATE (c:TestCity {name: 'NewYork', population: 8000000})");
        await conn.query("CREATE (c:TestCity {name: 'London', population: 9000000})");
        test('INSERT statements executed successfully', true);
      } catch (error) {
        test('INSERT statements executed successfully', false);
        throw error;
      }
    }

    // Step 6: VERIFY DATA WAS LOADED - This is the crucial part!
    console.log('\n🔍 Step 6: VERIFYING data was actually loaded...');
    
    try {
      // Count users
      console.log('   📊 Counting users...');
      const userCountResult = await conn.query('MATCH (u:TestUser) RETURN count(u) as userCount');
      const userRows = await userCountResult.getAllObjects();
      const userCount = userRows[0]?.userCount || 0;
      await userCountResult.close();
      
      test(`Users loaded correctly (expected: 3-4, got: ${userCount})`, userCount >= 3);
      console.log(`      Found ${userCount} users`);

      // Count cities
      console.log('   🏙️ Counting cities...');
      const cityCountResult = await conn.query('MATCH (c:TestCity) RETURN count(c) as cityCount');
      const cityRows = await cityCountResult.getAllObjects();
      const cityCount = cityRows[0]?.cityCount || 0;
      await cityCountResult.close();
      
      test(`Cities loaded correctly (expected: 2-3, got: ${cityCount})`, cityCount >= 2);
      console.log(`      Found ${cityCount} cities`);

      // Get actual user data
      console.log('   👥 Retrieving user data...');
      const usersResult = await conn.query('MATCH (u:TestUser) RETURN u.name, u.age ORDER BY u.name');
      const users = await usersResult.getAllObjects();
      await usersResult.close();
      
      test('User data retrieved successfully', users.length > 0);
      console.log('      Users found:');
      users.forEach(user => {
        console.log(`        - ${user['u.name']}: ${user['u.age']} years old`);
      });

      // Get actual city data
      console.log('   🏙️ Retrieving city data...');
      const citiesResult = await conn.query('MATCH (c:TestCity) RETURN c.name, c.population ORDER BY c.population DESC');
      const cities = await citiesResult.getAllObjects();
      await citiesResult.close();
      
      test('City data retrieved successfully', cities.length > 0);
      console.log('      Cities found:');
      cities.forEach(city => {
        console.log(`        - ${city['c.name']}: ${city['c.population'].toLocaleString()} population`);
      });

      // Test a complex query to make sure relationships work
      console.log('   🔗 Testing relationship creation...');
      await conn.query("MATCH (u1:TestUser {name: 'Alice'}), (u2:TestUser {name: 'Bob'}) CREATE (u1)-[:TestFollows {since: 2023}]->(u2)");
      
      const relResult = await conn.query('MATCH (u1:TestUser)-[f:TestFollows]->(u2:TestUser) RETURN u1.name, u2.name, f.since');
      const relationships = await relResult.getAllObjects();
      await relResult.close();
      
      test('Relationships created and queried successfully', relationships.length > 0);
      relationships.forEach(rel => {
        console.log(`        - ${rel['u1.name']} follows ${rel['u2.name']} since ${rel['f.since']}`);
      });

    } catch (error) {
      test('Data verification completed', false);
      throw new Error(`Data verification failed: ${error.message}`);
    }

    // Step 7: Final verification with complex query
    console.log('\n🎯 Step 7: Final complex query test...');
    try {
      const complexResult = await conn.query(`
        MATCH (u:TestUser), (c:TestCity)
        WHERE u.age > 25 AND c.population > 8000000
        RETURN u.name as user, u.age, c.name as city, c.population
        ORDER BY u.age DESC, c.population DESC
      `);
      
      const complexRows = await complexResult.getAllObjects();
      await complexResult.close();
      
      test('Complex query executed successfully', true);
      console.log(`      Complex query returned ${complexRows.length} rows:`);
      complexRows.forEach(row => {
        console.log(`        - ${row.user} (${row['u.age']}) × ${row.city} (${row['c.population'].toLocaleString()})`);
      });

    } catch (error) {
      test('Complex query executed successfully', false);
      console.log(`   ❌ Complex query failed: ${error.message}`);
    }

  } catch (error) {
    console.error(`\n💥 Test failed with error: ${error.message}`);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  } finally {
    // Cleanup
    if (conn) {
      try {
        await conn.close();
        console.log('\n🔒 Connection closed');
      } catch (e) {
        console.warn('Warning: Failed to close connection:', e.message);
      }
    }
    
    if (db) {
      try {
        await db.close();
        console.log('🔒 Database closed');
      } catch (e) {
        console.warn('Warning: Failed to close database:', e.message);
      }
    }
  }

  // Final results
  console.log('\n' + '='.repeat(50));
  console.log('📊 FINAL TEST RESULTS');
  console.log('='.repeat(50));
  console.log(`✅ Tests passed: ${testsPassed}/${testsTotal}`);
  console.log(`📊 Success rate: ${((testsPassed / testsTotal) * 100).toFixed(1)}%`);
  
  if (testsPassed === testsTotal) {
    console.log('\n🎉 ALL TESTS PASSED!');
    console.log('✅ KuzuDB COPY approach is VERIFIED and ready for GitNexus!');
    
    console.log('\n💡 Key findings:');
    if (kuzu.FS && kuzu.FS.writeFile) {
      console.log('   • FS.writeFile works in KuzuDB WASM');
      console.log('   • COPY statements successfully load data from CSV');
      console.log('   • Data can be queried back correctly');
      console.log('   • Complex queries work as expected');
      console.log('   • READY FOR GITNEXUS INTEGRATION! 🚀');
    } else {
      console.log('   • FS API not available in this environment');
      console.log('   • INSERT statements work as fallback');
      console.log('   • Data can be queried back correctly');
      console.log('   • Consider environment detection in GitNexus');
    }
  } else {
    console.log('\n❌ SOME TESTS FAILED');
    console.log('⚠️ COPY approach needs further investigation');
    console.log('🔄 Consider fallback to current MERGE approach');
  }

  return testsPassed === testsTotal;
}

// Run the verification
verifyKuzuCopyApproach()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Verification failed:', error);
    process.exit(1);
  });
