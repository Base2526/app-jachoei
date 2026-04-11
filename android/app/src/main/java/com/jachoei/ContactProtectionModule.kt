package com.jachoei

import android.content.ContentValues
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

class ContactProtectionModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val SPAM_NOTE_MARKER = "[Jachoei Spam]"
        private const val APPLIED_TARGET = "note"
    }

    private data class ContactMatch(
        val contactId: Long,
        val rawContactId: Long,
        val displayName: String?,
        val phoneNumber: String?,
        val matchedVariant: String?
    )

    private data class NoteRecord(
        val dataId: Long?,
        val note: String?
    )

    override fun getName(): String = "ContactProtection"

    @ReactMethod
    fun inspectPhone(phone: String, promise: Promise) {
        try {
            promise.resolve(buildInspectResult(phone, false, false))
        } catch (t: Throwable) {
            promise.reject("CONTACT_INSPECT_FAILED", t)
        }
    }

    @ReactMethod
    fun markContactAsSpam(phone: String, promise: Promise) {
        try {
            promise.resolve(markOrUnmark(phone, mark = true))
        } catch (t: Throwable) {
            promise.reject("CONTACT_MARK_FAILED", t)
        }
    }

    @ReactMethod
    fun unmarkContactAsSpam(phone: String, promise: Promise) {
        try {
            promise.resolve(markOrUnmark(phone, mark = false))
        } catch (t: Throwable) {
            promise.reject("CONTACT_UNMARK_FAILED", t)
        }
    }

    private fun markOrUnmark(phone: String, mark: Boolean): WritableMap {
        val hasRead = hasPermission(android.Manifest.permission.READ_CONTACTS)
        val hasWrite = hasPermission(android.Manifest.permission.WRITE_CONTACTS)
        if (!hasRead || !hasWrite) {
            return buildPermissionResult(hasRead, hasWrite)
        }

        val match = findMatchingContact(phone)
        if (match == null) {
            return buildEmptyResult(hasRead, hasWrite)
        }

        val existingNote = loadNoteRecord(match.rawContactId)
        val nextNote = if (mark) appendSpamMarker(existingNote.note) else removeSpamMarker(existingNote.note)
        upsertNote(match.rawContactId, existingNote.dataId, nextNote)

        return buildMatchResult(
            match = match,
            note = nextNote,
            hasRead = hasRead,
            hasWrite = hasWrite,
            applied = true
        )
    }

    private fun buildInspectResult(phone: String, applied: Boolean, hasWriteOverride: Boolean): WritableMap {
        val hasRead = hasPermission(android.Manifest.permission.READ_CONTACTS)
        val hasWrite = if (hasWriteOverride) true else hasPermission(android.Manifest.permission.WRITE_CONTACTS)
        if (!hasRead) return buildPermissionResult(hasRead, hasWrite)

        val match = findMatchingContact(phone)
        if (match == null) {
            return buildEmptyResult(hasRead, hasWrite)
        }

        val note = loadNoteRecord(match.rawContactId).note
        return buildMatchResult(match, note, hasRead, hasWrite, applied)
    }

    private fun buildPermissionResult(hasRead: Boolean, hasWrite: Boolean): WritableMap {
        val map = Arguments.createMap()
        map.putBoolean("permissionGranted", hasRead)
        map.putBoolean("writePermissionGranted", hasWrite)
        map.putBoolean("found", false)
        map.putBoolean("spamMarked", false)
        return map
    }

    private fun buildEmptyResult(hasRead: Boolean, hasWrite: Boolean): WritableMap {
        val map = buildPermissionResult(hasRead, hasWrite)
        map.putBoolean("permissionGranted", hasRead)
        map.putBoolean("writePermissionGranted", hasWrite)
        return map
    }

    private fun buildMatchResult(
        match: ContactMatch,
        note: String?,
        hasRead: Boolean,
        hasWrite: Boolean,
        applied: Boolean
    ): WritableMap {
        val map = Arguments.createMap()
        map.putBoolean("permissionGranted", hasRead)
        map.putBoolean("writePermissionGranted", hasWrite)
        map.putBoolean("found", true)
        map.putString("contactId", match.contactId.toString())
        map.putString("displayName", match.displayName)
        map.putString("note", note)
        map.putBoolean("spamMarked", isSpamMarked(match.displayName, note))
        map.putString("matchedNumber", match.phoneNumber)
        map.putString("matchedVariant", match.matchedVariant)
        map.putBoolean("applied", applied)
        map.putString("appliedTarget", APPLIED_TARGET)
        return map
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(reactContext, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun findMatchingContact(phone: String): ContactMatch? {
        val variants = PhoneUtils.variantsFromRaw(phone).toSet()
        if (variants.isEmpty()) return null

        val canonical = PhoneUtils.normalize(phone)
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.RAW_CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )

        reactContext.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            null
        )?.use { cursor ->
            val contactIdIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
            val rawContactIdIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.RAW_CONTACT_ID)
            val displayNameIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val numberIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)

            var bestMatch: ContactMatch? = null
            while (cursor.moveToNext()) {
                val phoneNumber = cursor.getString(numberIndex) ?: continue
                val rowVariants = PhoneUtils.variantsFromRaw(phoneNumber)
                val matchedVariant = rowVariants.firstOrNull { variants.contains(it) } ?: continue
                val candidate = ContactMatch(
                    contactId = cursor.getLong(contactIdIndex),
                    rawContactId = cursor.getLong(rawContactIdIndex),
                    displayName = cursor.getString(displayNameIndex),
                    phoneNumber = phoneNumber,
                    matchedVariant = matchedVariant
                )

                if (bestMatch == null || matchedVariant == canonical) {
                    bestMatch = candidate
                    if (matchedVariant == canonical) return bestMatch
                }
            }
            return bestMatch
        }

        return null
    }

    private fun loadNoteRecord(rawContactId: Long): NoteRecord {
        val projection = arrayOf(
            ContactsContract.Data._ID,
            ContactsContract.CommonDataKinds.Note.NOTE
        )

        reactContext.contentResolver.query(
            ContactsContract.Data.CONTENT_URI,
            projection,
            "${ContactsContract.Data.RAW_CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} = ?",
            arrayOf(rawContactId.toString(), ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE),
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val idIndex = cursor.getColumnIndexOrThrow(ContactsContract.Data._ID)
                val noteIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Note.NOTE)
                return NoteRecord(
                    dataId = cursor.getLong(idIndex),
                    note = cursor.getString(noteIndex)
                )
            }
        }

        return NoteRecord(dataId = null, note = null)
    }

    private fun upsertNote(rawContactId: Long, dataId: Long?, note: String?) {
        if (note.isNullOrBlank()) {
            if (dataId != null) {
                reactContext.contentResolver.delete(
                    ContactsContract.Data.CONTENT_URI,
                    "${ContactsContract.Data._ID} = ?",
                    arrayOf(dataId.toString())
                )
            }
            return
        }

        val values = ContentValues().apply {
            put(ContactsContract.CommonDataKinds.Note.NOTE, note)
        }

        if (dataId != null) {
            reactContext.contentResolver.update(
                ContactsContract.Data.CONTENT_URI,
                values,
                "${ContactsContract.Data._ID} = ?",
                arrayOf(dataId.toString())
            )
            return
        }

        values.put(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
        values.put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE)
        reactContext.contentResolver.insert(ContactsContract.Data.CONTENT_URI, values)
    }

    private fun appendSpamMarker(note: String?): String {
        val lines = note
            ?.lineSequence()
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?.toMutableList()
            ?: mutableListOf()

        if (lines.none { it.equals(SPAM_NOTE_MARKER, ignoreCase = true) }) {
            lines.add(0, SPAM_NOTE_MARKER)
        }
        return lines.joinToString("\n")
    }

    private fun removeSpamMarker(note: String?): String? {
        if (note.isNullOrBlank()) return null
        val lines = note
            .lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.equals(SPAM_NOTE_MARKER, ignoreCase = true) }
            .toList()

        if (lines.isEmpty()) return null
        return lines.joinToString("\n")
    }

    private fun isSpamMarked(displayName: String?, note: String?): Boolean {
        if (!note.isNullOrBlank() && note.contains(SPAM_NOTE_MARKER, ignoreCase = true)) return true
        return !displayName.isNullOrBlank() && displayName.trim().startsWith("[SPAM]", ignoreCase = true)
    }
}