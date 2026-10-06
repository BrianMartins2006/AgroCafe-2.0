from app import db
from datetime import datetime, timezone

class Atividade(db.Model):
    __tablename__ = 'atividade'
    
    id = db.Column(db.Integer, primary_key=True)
    id_lavoura_fk = db.Column(db.Integer, db.ForeignKey('lavoura.id'), nullable=False)
    id_tipo_atividade_fk = db.Column(db.Integer, db.ForeignKey('tipo_atividade.id'), nullable=False)
    data = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    descricao = db.Column(db.Text, nullable=True)
    responsavel = db.Column(db.String(100), nullable=True)
    
    lavoura = db.relationship('Lavoura', back_populates='atividades')
    tipo = db.relationship('TipoAtividade', backref='atividades')
    imagens = db.relationship('AtividadeImagem', back_populates='atividade', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'id_lavoura': self.id_lavoura_fk,
            'tipo': self.tipo.to_dict() if self.tipo else None,
            'data': self.data.isoformat() + 'Z' if self.data else None,
            'descricao': self.descricao,
            'responsavel': self.responsavel,
            'imagens': [img.to_dict() for img in self.imagens]
        }

    def __repr__(self):
        return f'<Atividade {self.id} for Lavoura {self.id_lavoura_fk}>'
