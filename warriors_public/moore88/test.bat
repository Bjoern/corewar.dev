@rem ** THIS FILE CALLS TESTXXXX FOR EVERY FILE WITHOUT AN EXTENSION **
@for %%f in (%1*.) do call testxxxx %%f
@scores %1
