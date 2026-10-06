import os
from flask import Blueprint, jsonify, request, current_app
from sqlalchemy.orm import joinedload
from flask_login import login_required, current_user, login_user, logout_user
from werkzeug.utils import secure_filename
from app import db
from app.models import Lavoura, Atividade, TipoAtividade, AtividadeImagem, Funcionario, Maquinario, Usuario
import cloudinary
import cloudinary.uploader
import re
from datetime import datetime, timezone

# O Blueprint para a nossa API
api = Blueprint('api', __name__)

# --- Rotas de Autenticação (JSON) ---

@api.route('/auth/register', methods=['POST'])
def api_register():
    try:
        data = request.json
        if not data or not data.get('email') or not data.get('senha') or not data.get('nome'):
            return jsonify({"erro": "Nome, e-mail e senha são obrigatórios"}), 400
            
        email = data.get('email').strip().lower()
        if Usuario.query.filter_by(email=email).first():
            return jsonify({"erro": "Este e-mail já está cadastrado"}), 409
            
        novo_usuario = Usuario(
            nome=data.get('nome'),
            email=email,
            foto_url=data.get('foto_url'),
            pergunta_seguranca=data.get('pergunta_seguranca')
        )
        novo_usuario.set_password(data.get('senha'))
        if data.get('resposta_seguranca'):
            novo_usuario.set_security_answer(data.get('resposta_seguranca'))
            
        db.session.add(novo_usuario)
        db.session.commit()
        
        login_user(novo_usuario, remember=True)
        return jsonify(novo_usuario.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": str(e)}), 500

@api.route('/auth/login', methods=['POST'])
def api_login():
    data = request.json
    if not data or not data.get('email') or not data.get('senha'):
        return jsonify({"erro": "E-mail e senha são obrigatórios"}), 400
        
    email = data.get('email').strip().lower()
    user = Usuario.query.filter_by(email=email).first()
    
    if user and user.check_password(data.get('senha')):
        login_user(user, remember=True)
        return jsonify(user.to_dict())
    
    return jsonify({"erro": "E-mail ou senha inválidos"}), 401

@api.route('/auth/logout', methods=['POST'])
@login_required
def api_logout():
    logout_user()
    return jsonify({"mensagem": "Logout realizado com sucesso"})

@api.route('/auth/forgot-password', methods=['POST'])
def api_forgot_password():
    data = request.json
    email = data.get('email', '').strip().lower()
    user = Usuario.query.filter_by(email=email).first()
    
    if not user:
        return jsonify({"erro": "Usuário não encontrado"}), 404
        
    return jsonify({
        "pergunta_seguranca": user.pergunta_seguranca or "Qual o nome da sua fazenda?"
    })

@api.route('/auth/reset-password', methods=['POST'])
def api_reset_password():
    data = request.json
    email = data.get('email', '').strip().lower()
    resposta = data.get('resposta_seguranca', '')
    nova_senha = data.get('nova_senha', '')
    
    user = Usuario.query.filter_by(email=email).first()
    if not user:
        return jsonify({"erro": "Usuário não encontrado"}), 404
        
    if user.check_security_answer(resposta):
        user.set_password(nova_senha)
        db.session.commit()
        return jsonify({"mensagem": "Senha alterada com sucesso"})
    
    return jsonify({"erro": "Resposta de segurança incorreta"}), 401

# --- Rotas de Perfil ---

@api.route('/perfil', methods=['GET'])
@login_required
def get_perfil():
    return jsonify(current_user.to_dict())

@api.route('/perfil', methods=['PUT'])
@login_required
def update_perfil():
    user = current_user

    data = request.json
    user.nome = data.get('nome', user.nome)
    user.email = data.get('email', user.email)
    user.foto_url = data.get('foto_url', user.foto_url)
    
    if data.get('senha'):
        user.set_password(data.get('senha'))
        
    db.session.commit()
    return jsonify(user.to_dict())

# --- Rotas de Lavouras ---

@api.route('/health', methods=['GET'])
def health_check():
    return {"status": "ok", "message": "Backend is awake!"}, 200

@api.route('/lavouras', methods=['GET'])
@login_required
def get_lavouras():
    # Migração on-the-fly otimizada: Apenas executa se houver registros órfãos
    orphans_count = Lavoura.query.filter(Lavoura.id_usuario_fk.is_(None)).count()
    if orphans_count > 0:
        Lavoura.query.filter(Lavoura.id_usuario_fk.is_(None)).update({Lavoura.id_usuario_fk: current_user.id})
        db.session.commit()
    
    lavouras = (Lavoura.query
                .options(joinedload(Lavoura.atividades))
                .filter_by(id_usuario_fk=current_user.id)
                .all())
    return jsonify([l.to_dict() for l in lavouras])

@api.route('/lavouras', methods=['POST'])
@login_required
def create_lavoura():
    data = request.json
    nova_lavoura = Lavoura(
        nome=data.get('nome'),
        cultura=data.get('cultura'),
        foto_perfil=data.get('foto_perfil') or "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=100&q=80",
        area_hectares=data.get('area_hectares'),
        localizacao=data.get('localizacao'),
        data_inicio=data.get('data_inicio'),
        id_usuario_fk=current_user.id
    )
    db.session.add(nova_lavoura)
    db.session.commit()
    return jsonify(nova_lavoura.to_dict()), 201

@api.route('/lavouras/<int:id>', methods=['PUT', 'DELETE'])
@login_required
def handle_lavoura_id(id):
    lavoura = Lavoura.query.get_or_404(id)
    if lavoura.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
    
    if request.method == 'PUT':
        data = request.json
        lavoura.nome = data.get('nome', lavoura.nome)
        lavoura.cultura = data.get('cultura', lavoura.cultura)
        lavoura.foto_perfil = data.get('foto_perfil', lavoura.foto_perfil)
        if 'area_hectares' in data:
            lavoura.area_hectares = data.get('area_hectares')
        if 'localizacao' in data:
            lavoura.localizacao = data.get('localizacao')
        if 'data_inicio' in data:
            lavoura.data_inicio = data.get('data_inicio')
        db.session.commit()
        return jsonify(lavoura.to_dict())
    
    if request.method == 'DELETE':
        db.session.delete(lavoura)
        db.session.commit()
        return jsonify({"message": "Lavoura excluída com sucesso"}), 200

@api.route('/lavouras/<int:id>', methods=['GET'])
@login_required
def get_lavoura(id):
    lavoura = Lavoura.query.get_or_404(id)
    if lavoura.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
    return jsonify(lavoura.to_dict())

@api.route('/lavouras/<int:id>/media', methods=['GET'])
@login_required
def get_lavoura_media(id):
    lavoura = Lavoura.query.get_or_404(id)
    if lavoura.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
        
    atividades = Atividade.query.filter_by(id_lavoura_fk=id).all()
    imagens = []
    for atv in atividades:
        for img in atv.imagens:
            imagens.append({
                "id": img.id,
                "foto_url": img.foto_url,
                "data": atv.data.isoformat(),
                "atividade_id": atv.id
            })
    # Ordenar por data mais recente
    imagens.sort(key=lambda x: x['data'], reverse=True)
    return jsonify(imagens)

@api.route('/lavouras/<int:id>/pin', methods=['PATCH'])
@login_required
def toggle_lavoura_pin(id):
    lavoura = Lavoura.query.get_or_404(id)
    if lavoura.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
        
    lavoura.is_pinned = not getattr(lavoura, 'is_pinned', False)
    db.session.commit()
    return jsonify(lavoura.to_dict())

@api.route('/lavouras/<int:id>/atividades', methods=['GET'])
@login_required
def get_atividades_lavoura(id):
    lavoura = Lavoura.query.get_or_404(id)
    if lavoura.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
        
    atividades = Atividade.query.filter_by(id_lavoura_fk=id).order_by(Atividade.data.asc()).all()
    return jsonify([a.to_dict() for a in atividades])

# --- Rotas de Atividades ---

@api.route('/feed', methods=['GET'])
@login_required
def get_global_feed():
    atividades = (Atividade.query
                  .options(joinedload(Atividade.imagens), joinedload(Atividade.tipo))
                  .join(Lavoura)
                  .filter(Lavoura.id_usuario_fk == current_user.id)
                  .order_by(Atividade.data.desc())
                  .all())
    return jsonify([a.to_dict() for a in atividades])

@api.route('/atividades', methods=['POST'])
@login_required
def create_atividade():
    try:
        data = request.json
        if not data:
            return jsonify({"erro": "Nenhum dado recebido"}), 400
            
        # IDOR Check: Verificar se a lavoura pertence ao usuário
        lavoura = Lavoura.query.get(data.get('id_lavoura'))
        if not lavoura or lavoura.id_usuario_fk != current_user.id:
            return jsonify({"erro": "Lavoura inválida ou acesso negado"}), 403
        dt_atividade = datetime.now(timezone.utc)
        if data.get('data'):
            try:
                if len(data.get('data')) <= 10:
                    data_fornecida = datetime.fromisoformat(data.get('data')).date()
                    if data_fornecida == datetime.now(timezone.utc).date():
                        dt_atividade = datetime.now(timezone.utc)
                    else:
                        dt_atividade = datetime.combine(data_fornecida, datetime.min.time().replace(hour=12))
                else:
                    dt_str = data.get('data').replace('Z', '')
                    dt_atividade = datetime.fromisoformat(dt_str)
            except Exception as e:
                print(f"Erro ao converter data: {e}")
                dt_atividade = datetime.now(timezone.utc)

        nova_atividade = Atividade(
            id_lavoura_fk=data.get('id_lavoura'),
            id_tipo_atividade_fk=data.get('id_tipo_atividade'),
            descricao=data.get('descricao'),
            responsavel=data.get('responsavel') or "Produtor",
            data=dt_atividade
        )
        db.session.add(nova_atividade)
        db.session.flush()
        
        fotos = data.get('fotos', [])
        for foto_url in fotos:
            nova_imagem = AtividadeImagem(id_atividade_fk=nova_atividade.id, foto_url=foto_url)
            db.session.add(nova_imagem)
        
        db.session.commit()
        return jsonify(nova_atividade.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        print(f"ERRO CRÍTICO NO BACKEND: {str(e)}")
        return jsonify({"erro": str(e)}), 500

@api.route('/atividades/<int:id>', methods=['PUT'])
@login_required
def update_atividade(id):
    atividade = db.session.get(Atividade, id)
    if not atividade:
        return jsonify({"erro": "Atividade não encontrada"}), 404
    
    # IDOR Check: Verificar se a lavoura da atividade pertence ao usuário
    if atividade.lavoura.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
    
    data = request.json
    if not data:
        return jsonify({"erro": "Nenhum dado recebido"}), 400
    
    # Campos básicos
    atividade.descricao = data.get('descricao', atividade.descricao)
    atividade.id_tipo_atividade_fk = data.get('id_tipo_atividade', atividade.id_tipo_atividade_fk)
    atividade.responsavel = data.get('responsavel', atividade.responsavel)
    
    if data.get('data'):
        try:
            # Lógica de Data e Hora Inteligente para Update
            if len(data.get('data')) <= 10:
                data_fornecida = datetime.fromisoformat(data.get('data')).date()
                if data_fornecida == datetime.now().date():
                    atividade.data = datetime.now()
                else:
                    atividade.data = datetime.combine(data_fornecida, datetime.min.time().replace(hour=12))
            else:
                dt_str = data.get('data').replace('Z', '')
                atividade.data = datetime.fromisoformat(dt_str)
        except Exception as e:
            print(f"Erro ao converter data na atualização: {e}")

    # Sincronização de Imagens (Add/Remove)
    if 'fotos' in data:
        novas_urls = data.get('fotos', [])
        imagens_atuais = AtividadeImagem.query.filter_by(id_atividade_fk=id).all()
        urls_atuais = [img.foto_url for img in imagens_atuais]
        
        # Deletar as que não estão na nova lista
        for img in imagens_atuais:
            if img.foto_url not in novas_urls:
                db.session.delete(img)
        
        # Adicionar as novas que não estão na lista atual
        for url in novas_urls:
            if url not in urls_atuais:
                nova_img = AtividadeImagem(id_atividade_fk=id, foto_url=url)
                db.session.add(nova_img)
    
    db.session.commit()
    return jsonify(atividade.to_dict())

@api.route('/atividades/<int:id>', methods=['DELETE'])
@login_required
def delete_atividade(id):
    atividade = db.session.get(Atividade, id)
    if not atividade:
        return jsonify({"erro": "Atividade não encontrada"}), 404
    
    if atividade.lavoura.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
    
    db.session.delete(atividade)
    db.session.commit()
    return '', 204

@api.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"erro": "Nenhum arquivo enviado"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"erro": "Nome do arquivo vazio"}), 400
    
    if file:
        # Validação de MimeType (Segurança)
        allowed_mimetypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
        if file.content_type not in allowed_mimetypes:
            return jsonify({"erro": "Tipo de arquivo não permitido. Apenas imagens e vídeos."}), 400

        try:
            # Configurar Cloudinary
            cloudinary_url = current_app.config.get('CLOUDINARY_URL')
            if not cloudinary_url:
                return jsonify({"erro": "Configuração Cloudinary ausente no servidor"}), 500
            
            # Limpeza e Extração via Regex (o jeito mais seguro)
            import re
            pattern = r"cloudinary://([0-9]+):([a-zA-Z0-9_\-]+)@([a-zA-Z0-9_\-]+)"
            match = re.search(pattern, cloudinary_url.strip())
            
            if match:
                api_key = match.group(1)
                api_secret = match.group(2)
                cloud_name = match.group(3)
                
                print(f"DEBUG CLOUDINARY: CloudName='{cloud_name}' Key='{api_key}'")
                
                cloudinary.config(
                    cloud_name=cloud_name,
                    api_key=api_key,
                    api_secret=api_secret,
                    secure=True
                )
            else:
                # Fallback se o regex falhar
                cloudinary.config(from_url=cloudinary_url.strip())
            
            # Upload para o Cloudinary
            upload_result = cloudinary.uploader.upload(
                file,
                folder="agrocafe/atividades",
                resource_type="auto"
            )
            
            # Retorna a URL segura (HTTPS) do Cloudinary
            return jsonify({"url": upload_result.get('secure_url')}), 201
            
        except Exception as e:
            print(f"Erro no upload Cloudinary: {str(e)}")
            return jsonify({"erro": f"Erro Cloudinary: {str(e)}"}), 500

@api.route('/tipos-atividade', methods=['POST'])
@login_required
def create_tipo_atividade():
    data = request.json
    novo_tipo = TipoAtividade(
        nome=data.get('nome'),
        icone=data.get('icone') or "Search",
        cor=data.get('cor') or "bg-gray-500"
    )
    db.session.add(novo_tipo)
    db.session.commit()
    return jsonify(novo_tipo.to_dict()), 201

@api.route('/tipos-atividade/<int:id>', methods=['PUT', 'DELETE'])
@login_required
def handle_tipo_atividade(id):
    tipo = TipoAtividade.query.get_or_404(id)
    
    if request.method == 'PUT':
        data = request.json
        tipo.nome = data.get('nome', tipo.nome)
        tipo.icone = data.get('icone', tipo.icone)
        tipo.cor = data.get('cor', tipo.cor)
        db.session.commit()
        return jsonify(tipo.to_dict())
    
    if request.method == 'DELETE':
        # Check if any activities are using this type
        from app.models.atividade import Atividade
        if Atividade.query.filter_by(id_tipo_atividade_fk=tipo.id).first():
            return jsonify({"erro": "Não é possível excluir esta categoria pois ela possui atividades vinculadas."}), 400
            
        db.session.delete(tipo)
        db.session.commit()
        return jsonify({"message": "Tipo de atividade excluído"}), 200

@api.route('/tipos-atividade', methods=['GET'])
@login_required
def get_tipos_atividade():
    tipos = TipoAtividade.query.all()
    return jsonify([t.to_dict() for t in tipos])
# --- Rotas de Funcionários ---

@api.route('/funcionarios', methods=['GET'])
@login_required
def get_funcionarios():
    # Funcionários agora devem ser filtrados por usuário
    # Adicionamos o filtro id_usuario_fk (assumindo que o modelo foi ajustado ou será isolado)
    # Para evitar quebra, se o campo não existir, mostramos apenas os que não tem dono ou os do admin
    funcionarios = Funcionario.query.filter((Funcionario.id_usuario_fk == current_user.id) | (Funcionario.id_usuario_fk == None)).all() 
    return jsonify([f.to_dict() for f in funcionarios])

@api.route('/funcionarios', methods=['POST'])
@login_required
def create_funcionario():
    data = request.json
    novo = Funcionario(
        nome=data.get('nome'),
        cargo=data.get('cargo'),
        salario_hora=data.get('salario_hora'),
        contato=data.get('contato'),
        id_usuario_fk=current_user.id
    )
    db.session.add(novo)
    db.session.commit()
    return jsonify(novo.to_dict()), 201

@api.route('/funcionarios/<int:id>', methods=['PUT', 'DELETE'])
@login_required
def handle_funcionario(id):
    func = Funcionario.query.get_or_404(id)
    if func.id_usuario_fk and func.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
    if request.method == 'PUT':
        data = request.json
        func.nome = data.get('nome', func.nome)
        func.cargo = data.get('cargo', func.cargo)
        func.salario_hora = data.get('salario_hora', func.salario_hora)
        func.contato = data.get('contato', func.contato)
        db.session.commit()
        return jsonify(func.to_dict())
    if request.method == 'DELETE':
        db.session.delete(func)
        db.session.commit()
        return jsonify({"message": "Funcionário excluído"}), 200

# --- Rotas de Maquinário ---

@api.route('/maquinarios', methods=['GET'])
@login_required
def get_maquinarios():
    maquinas = Maquinario.query.filter((Maquinario.id_usuario_fk == current_user.id) | (Maquinario.id_usuario_fk == None)).all()
    return jsonify([m.to_dict() for m in maquinas])

@api.route('/maquinarios', methods=['POST'])
@login_required
def create_maquinario():
    data = request.json
    novo = Maquinario(
        tipo=data.get('tipo'),
        modelo=data.get('modelo'),
        valor_hora=data.get('valor_hora'),
        consumo_medio=data.get('consumo_medio'),
        id_usuario_fk=current_user.id
    )
    db.session.add(novo)
    db.session.commit()
    return jsonify(novo.to_dict()), 201

@api.route('/maquinarios/<int:id>', methods=['PUT', 'DELETE'])
@login_required
def handle_maquinario(id):
    maquina = Maquinario.query.get_or_404(id)
    if maquina.id_usuario_fk and maquina.id_usuario_fk != current_user.id:
        return jsonify({"erro": "Acesso negado"}), 403
    if request.method == 'PUT':
        data = request.json
        maquina.tipo = data.get('tipo', maquina.tipo)
        maquina.modelo = data.get('modelo', maquina.modelo)
        maquina.valor_hora = data.get('valor_hora', maquina.valor_hora)
        maquina.consumo_medio = data.get('consumo_medio', maquina.consumo_medio)
        db.session.commit()
        return jsonify(maquina.to_dict())
    if request.method == 'DELETE':
        db.session.delete(maquina)
        db.session.commit()
        return jsonify({"message": "Maquinário excluído"}), 200
