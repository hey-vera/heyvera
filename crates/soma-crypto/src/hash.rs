pub fn blake3(data: &[u8]) -> [u8; 32] {
    *blake3::hash(data).as_bytes()
}

pub fn blake3_keyed(key: &[u8; 32], data: &[u8]) -> [u8; 32] {
    *blake3::keyed_hash(key, data).as_bytes()
}

pub fn blake3_kdf(key: &[u8], context: &str, len: usize) -> Vec<u8> {
    let mut output = vec![0u8; len];
    let mut deriver = blake3::Hasher::new_derive_key(context);
    deriver.update(key);
    let mut reader = deriver.finalize_xof();
    reader.fill(&mut output);
    output
}

pub fn heart_id(ed25519_pk: &[u8; 32], mldsa65_pk: &[u8]) -> [u8; 32] {
    let mut input = Vec::with_capacity(32 + mldsa65_pk.len());
    input.extend_from_slice(ed25519_pk);
    input.extend_from_slice(mldsa65_pk);
    blake3(&input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blake3_deterministic() {
        let a = blake3(b"soma protocol");
        let b = blake3(b"soma protocol");
        assert_eq!(a, b);
    }

    #[test]
    fn blake3_different_inputs() {
        let a = blake3(b"soma");
        let b = blake3(b"vera");
        assert_ne!(a, b);
    }

    #[test]
    fn blake3_kdf_domain_separation() {
        let key = b"root-secret-material-for-testing";
        let a = blake3_kdf(key, "soma.heart.sign.v1", 32);
        let b = blake3_kdf(key, "soma.room.agree.v1", 32);
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn heart_id_deterministic() {
        let ed_pk = [42u8; 32];
        let pq_pk = vec![7u8; 1952];
        let id1 = heart_id(&ed_pk, &pq_pk);
        let id2 = heart_id(&ed_pk, &pq_pk);
        assert_eq!(id1, id2);
    }

    #[test]
    fn heart_id_changes_with_any_key() {
        let ed_pk = [42u8; 32];
        let pq_pk = vec![7u8; 1952];
        let id1 = heart_id(&ed_pk, &pq_pk);

        let mut ed_pk2 = ed_pk;
        ed_pk2[0] ^= 1;
        let id2 = heart_id(&ed_pk2, &pq_pk);
        assert_ne!(id1, id2);

        let mut pq_pk2 = pq_pk.clone();
        pq_pk2[0] ^= 1;
        let id3 = heart_id(&ed_pk, &pq_pk2);
        assert_ne!(id1, id3);
    }

    #[test]
    fn export_test_vectors() {
        let vectors = serde_json::json!({
            "blake3": [
                {
                    "input_hex": hex::encode(b"soma protocol"),
                    "output_hex": hex::encode(blake3(b"soma protocol")),
                },
                {
                    "input_hex": hex::encode(b""),
                    "output_hex": hex::encode(blake3(b"")),
                },
            ],
            "blake3_kdf": [
                {
                    "key_hex": hex::encode(b"root-secret-material-for-testing"),
                    "context": "soma.heart.sign.v1",
                    "output_len": 32,
                    "output_hex": hex::encode(blake3_kdf(b"root-secret-material-for-testing", "soma.heart.sign.v1", 32)),
                },
            ],
        });
        let json = serde_json::to_string_pretty(&vectors).unwrap();
        std::fs::create_dir_all("test-vectors").ok();
        std::fs::write("test-vectors/hash.json", json).unwrap();
    }
}
